import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import type { AppRole, ActorInput } from '../contracts';
import {
  computeSha256Bytes,
  computeSha256Hex,
  randomBytes,
} from '../auth/crypto';
import { tickVectorClock } from '../crdt';
import {
  createSecureDeviceKeyVault,
  defaultDeviceKeyVault,
  type DeviceKeyVault,
} from '../auth/key-vault';
import { createSQLiteLedgerService } from '../auth/ledger-service';

import {
  hashNonce,
  signPodPayload,
  verifyPodPayloadSignature,
} from './crypto';
import {
  decodePodChallenge,
  decodeQrPayload,
  encodePodChallenge,
  encodePodReceipt,
  encodeQrPayload,
  encodeRecipientSigningPayload,
  encodeUnsignedPodChallenge,
  type PodChallengeWire,
  type PodReceiptWire,
} from './protocol';

type Scalar = SQLiteScalar | undefined;

export type PodVerificationState =
  | 'challenge-generated'
  | 'verification-success'
  | 'signature-mismatch'
  | 'replay-rejected'
  | 'challenge-expired';

export type CreatePodChallengeInput = {
  actor: ActorInput;
  deliveryId: string;
  expiresInMs?: number;
};

export type CreatedPodChallenge = {
  receiptId: string;
  challengeId: string;
  deliveryId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  senderDeviceId: string;
  senderPublicKeyId: string;
  payloadHashHex: string;
  qrPayload: string;
};

export type VerifyPodChallengeInput = {
  actor: ActorInput;
  challengePayload: string;
};

export type PodVerificationResult = {
  receiptId?: string;
  challengeId?: string;
  deliveryId?: string;
  state: PodVerificationState;
  rejectionCode?: string;
  rejectionReason?: string;
  verifiedAtMs?: number;
};

export type PodReceiptRecord = {
  receiptId: string;
  challengeId: string;
  deliveryId: string;
  status: string;
  senderDeviceId: string;
  recipientDeviceId?: string;
  issuedAtMs: number;
  expiresAtMs: number;
  verifiedAtMs?: number;
  rejectionCode?: string;
  rejectionReason?: string;
};

export interface PodService {
  createSignedChallenge(input: CreatePodChallengeInput): Promise<CreatedPodChallenge>;
  verifyScannedChallenge(input: VerifyPodChallengeInput): Promise<PodVerificationResult>;
  getLatestReceiptForDelivery(deliveryId: string): Promise<PodReceiptRecord | null>;
}

export function createSQLitePodService(
  dbProvider?: () => Promise<DatabaseHandle>,
  keyVault: DeviceKeyVault = createSecureDeviceKeyVault(defaultDeviceKeyVault),
): PodService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  return new SQLitePodService(resolvedDbProvider, keyVault);
}

class SQLitePodService implements PodService {
  constructor(
    private readonly dbProvider: () => Promise<DatabaseHandle>,
    private readonly keyVault: DeviceKeyVault,
  ) {}

  async createSignedChallenge(
    input: CreatePodChallengeInput,
  ): Promise<CreatedPodChallenge> {
    const db = await this.dbProvider();
    const nowMs = Date.now();
    const expiresAtMs = nowMs + clampExpiryMs(input.expiresInMs);
    const challengeId = createIdentifier('pod-ch');
    const receiptId = createIdentifier('pod');

    await ensureDeliveryExists(db, input.deliveryId);
    const senderIdentity = await loadDeviceIdentity(db, input.actor.deviceId);
    if (!senderIdentity) {
      throw new Error(`Device identity ${input.actor.deviceId} not found.`);
    }
    const senderKeys = await this.keyVault.get(input.actor.deviceId);

    if (!senderKeys) {
      throw new Error(
        `Device key material for ${input.actor.deviceId} is unavailable. Re-authenticate to provision keys.`,
      );
    }

    const manifestHash = await computeDeliveryPayloadHash(db, input.deliveryId);
    const nonce = randomBytes(16);
    const unsignedChallenge = {
      challengeId,
      deliveryId: input.deliveryId,
      senderDeviceId: input.actor.deviceId,
      senderUserId: input.actor.userId,
      senderPublicKeyId: senderIdentity.keyFingerprint,
      payloadHash: manifestHash.hashBytes,
      nonce,
      issuedAtMs: nowMs,
      expiresAtMs,
    };

    const unsignedBytes = encodeUnsignedPodChallenge(unsignedChallenge);
    const senderSignatureBytes = signPodPayload(
      unsignedBytes,
      senderKeys.secretKeyHex,
    );
    const challenge: PodChallengeWire = {
      ...unsignedChallenge,
      senderSignature: {
        algorithm: 'ED25519',
        signature: senderSignatureBytes,
        keyId: senderIdentity.keyFingerprint,
      },
    };
    const challengeBytes = encodePodChallenge(challenge);

    await db.execute(
      `
        INSERT OR REPLACE INTO pod_receipts (
          receipt_id,
          delivery_id,
          challenge_id,
          status,
          sender_device_id,
          sender_user_id,
          sender_public_key_id,
          recipient_user_id,
          recipient_device_id,
          nonce,
          payload_hash,
          issued_at_ms,
          expires_at_ms,
          verified_at_ms,
          rejection_code,
          rejection_reason,
          receipt_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receiptId,
        input.deliveryId,
        challengeId,
        'pending',
        input.actor.deviceId,
        input.actor.userId,
        senderIdentity.keyFingerprint,
        null,
        null,
        nonce,
        manifestHash.hashBytes,
        nowMs,
        expiresAtMs,
        null,
        null,
        null,
        null,
        JSON.stringify({
          issuedByRole: input.actor.role,
          payloadHashHex: manifestHash.hashHex,
          challengePayload: encodeQrPayload(challengeBytes),
        }),
      ],
    );

    await this.appendReceiptLedgerEvent({
      db,
      actor: input.actor,
      receiptId,
      deliveryId: input.deliveryId,
      status: 'challenge-generated',
      payloadType: 'digitaldelta.v1.pod.challenge',
      payloadBlob: challengeBytes,
      metadata: {
        challengeId,
        senderDeviceId: input.actor.deviceId,
        senderPublicKeyId: senderIdentity.keyFingerprint,
      },
    });

    return {
      receiptId,
      challengeId,
      deliveryId: input.deliveryId,
      issuedAtMs: nowMs,
      expiresAtMs,
      senderDeviceId: input.actor.deviceId,
      senderPublicKeyId: senderIdentity.keyFingerprint,
      payloadHashHex: manifestHash.hashHex,
      qrPayload: encodeQrPayload(challengeBytes),
    };
  }

  async verifyScannedChallenge(
    input: VerifyPodChallengeInput,
  ): Promise<PodVerificationResult> {
    const db = await this.dbProvider();
    let challenge: PodChallengeWire;
    let challengeBytes: Uint8Array;

    try {
      challengeBytes = decodeQrPayload(input.challengePayload);
      challenge = decodePodChallenge(challengeBytes);
    } catch {
      return {
        state: 'signature-mismatch',
        rejectionCode: 'QR_PAYLOAD_INVALID',
        rejectionReason: 'Scanned QR payload is unreadable or malformed.',
      };
    }

    const receiptRecord = await findReceiptByChallengeId(db, challenge.challengeId);
    const receiptId = receiptRecord?.receiptId ?? createIdentifier('pod');
    const nowMs = Date.now();

    const senderIdentity = await loadDeviceIdentity(
      db,
      challenge.senderDeviceId,
      false,
    );
    if (!senderIdentity) {
      await this.persistRejectedReceipt({
        db,
        receiptId,
        challenge,
        code: 'SENDER_IDENTITY_UNKNOWN',
        reason: 'Sender identity is not available on this node.',
        actor: input.actor,
      });

      return {
        receiptId,
        challengeId: challenge.challengeId,
        deliveryId: challenge.deliveryId,
        state: 'signature-mismatch',
        rejectionCode: 'SENDER_IDENTITY_UNKNOWN',
        rejectionReason: 'Sender identity is not available on this node.',
      };
    }

    const signatureRecord = challenge.senderSignature;
    if (!signatureRecord) {
      await this.persistRejectedReceipt({
        db,
        receiptId,
        challenge,
        code: 'CHALLENGE_UNSIGNED',
        reason: 'Challenge payload is missing sender signature.',
        actor: input.actor,
      });

      return {
        receiptId,
        challengeId: challenge.challengeId,
        deliveryId: challenge.deliveryId,
        state: 'signature-mismatch',
        rejectionCode: 'CHALLENGE_UNSIGNED',
        rejectionReason: 'Challenge payload is missing sender signature.',
      };
    }

    const unsignedBytes = encodeUnsignedPodChallenge({
      challengeId: challenge.challengeId,
      deliveryId: challenge.deliveryId,
      senderDeviceId: challenge.senderDeviceId,
      senderUserId: challenge.senderUserId,
      senderPublicKeyId: challenge.senderPublicKeyId,
      payloadHash: challenge.payloadHash,
      nonce: challenge.nonce,
      issuedAtMs: challenge.issuedAtMs,
      expiresAtMs: challenge.expiresAtMs,
    });

    const keyFingerprintMatches =
      challenge.senderPublicKeyId === senderIdentity.keyFingerprint &&
      signatureRecord.keyId === senderIdentity.keyFingerprint;
    const signatureValid =
      keyFingerprintMatches &&
      verifyPodPayloadSignature({
        payload: unsignedBytes,
        signature: signatureRecord.signature,
        publicKeyPem: senderIdentity.publicKeyPem,
      });

    if (!signatureValid) {
      await this.persistRejectedReceipt({
        db,
        receiptId,
        challenge,
        code: 'SIGNATURE_INVALID',
        reason: 'Challenge signature does not match sender identity.',
        actor: input.actor,
      });

      return {
        receiptId,
        challengeId: challenge.challengeId,
        deliveryId: challenge.deliveryId,
        state: 'signature-mismatch',
        rejectionCode: 'SIGNATURE_INVALID',
        rejectionReason: 'Challenge signature does not match sender identity.',
      };
    }

    if (nowMs > challenge.expiresAtMs) {
      await this.persistRejectedReceipt({
        db,
        receiptId,
        challenge,
        code: 'CHALLENGE_EXPIRED',
        reason: 'Challenge is outside its validity window.',
        actor: input.actor,
      });

      return {
        receiptId,
        challengeId: challenge.challengeId,
        deliveryId: challenge.deliveryId,
        state: 'challenge-expired',
        rejectionCode: 'CHALLENGE_EXPIRED',
        rejectionReason: 'Challenge is outside its validity window.',
      };
    }

    const nonceHash = hashNonce(challenge.nonce);
    const existingNonce = await db.execute(
      `
        SELECT nonce_hash AS nonceHash
        FROM used_nonces
        WHERE nonce_hash = ?
        LIMIT 1
      `,
      [nonceHash],
    );

    if (existingNonce.rows[0]) {
      await this.persistRejectedReceipt({
        db,
        receiptId,
        challenge,
        code: 'REPLAY_NONCE_USED',
        reason: 'Nonce has already been consumed by a prior receipt.',
        actor: input.actor,
        status: 'replay_rejected',
      });

      return {
        receiptId,
        challengeId: challenge.challengeId,
        deliveryId: challenge.deliveryId,
        state: 'replay-rejected',
        rejectionCode: 'REPLAY_NONCE_USED',
        rejectionReason: 'Nonce has already been consumed by a prior receipt.',
      };
    }

    const recipientIdentity = await loadDeviceIdentity(db, input.actor.deviceId);
    if (!recipientIdentity) {
      throw new Error(`Device identity ${input.actor.deviceId} not found.`);
    }
    const recipientKeys = await this.keyVault.get(input.actor.deviceId);
    if (!recipientKeys) {
      throw new Error(
        `Device key material for ${input.actor.deviceId} is unavailable. Re-authenticate to provision keys.`,
      );
    }

    const verifiedAtMs = Date.now();
    const recipientSigningPayload = encodeRecipientSigningPayload({
      challengeBytes,
      recipientUserId: input.actor.userId,
      recipientDeviceId: input.actor.deviceId,
      verifiedAtMs,
    });
    const recipientSignatureBytes = signPodPayload(
      recipientSigningPayload,
      recipientKeys.secretKeyHex,
    );

    const receipt: PodReceiptWire = {
      receiptId,
      deliveryId: challenge.deliveryId,
      status: 'VERIFIED',
      challenge,
      recipientUserId: input.actor.userId,
      recipientDeviceId: input.actor.deviceId,
      recipientSignature: {
        algorithm: 'ED25519',
        signature: recipientSignatureBytes,
        keyId: recipientIdentity.keyFingerprint,
      },
      verifiedAtMs,
    };
    const receiptBytes = encodePodReceipt(receipt);

    await db.execute(
      `
        INSERT OR REPLACE INTO pod_receipts (
          receipt_id,
          delivery_id,
          challenge_id,
          status,
          sender_device_id,
          sender_user_id,
          sender_public_key_id,
          recipient_user_id,
          recipient_device_id,
          nonce,
          payload_hash,
          issued_at_ms,
          expires_at_ms,
          verified_at_ms,
          rejection_code,
          rejection_reason,
          receipt_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receiptId,
        challenge.deliveryId,
        challenge.challengeId,
        'verified',
        challenge.senderDeviceId,
        challenge.senderUserId,
        challenge.senderPublicKeyId,
        input.actor.userId,
        input.actor.deviceId,
        challenge.nonce,
        challenge.payloadHash,
        challenge.issuedAtMs,
        challenge.expiresAtMs,
        verifiedAtMs,
        null,
        null,
        receiptBytes,
        JSON.stringify({
          recipientPublicKeyId: recipientIdentity.keyFingerprint,
          nonceHash,
          verifiedByRole: input.actor.role,
        }),
      ],
    );

    await db.execute(
      `
        INSERT INTO used_nonces (
          nonce_hash,
          delivery_id,
          receipt_id,
          consumed_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [
        nonceHash,
        challenge.deliveryId,
        receiptId,
        verifiedAtMs,
        JSON.stringify({
          challengeId: challenge.challengeId,
        }),
      ],
    );

    await this.appendReceiptLedgerEvent({
      db,
      actor: input.actor,
      receiptId,
      deliveryId: challenge.deliveryId,
      status: 'verification-success',
      payloadType: 'digitaldelta.v1.pod.receipt',
      payloadBlob: receiptBytes,
      metadata: {
        challengeId: challenge.challengeId,
        senderDeviceId: challenge.senderDeviceId,
        recipientDeviceId: input.actor.deviceId,
        nonceHash,
      },
    });

    return {
      receiptId,
      challengeId: challenge.challengeId,
      deliveryId: challenge.deliveryId,
      state: 'verification-success',
      verifiedAtMs,
    };
  }

  async getLatestReceiptForDelivery(
    deliveryId: string,
  ): Promise<PodReceiptRecord | null> {
    const db = await this.dbProvider();
    const result = await db.execute(
      `
        SELECT
          receipt_id AS receiptId,
          challenge_id AS challengeId,
          delivery_id AS deliveryId,
          status,
          sender_device_id AS senderDeviceId,
          recipient_device_id AS recipientDeviceId,
          issued_at_ms AS issuedAtMs,
          expires_at_ms AS expiresAtMs,
          verified_at_ms AS verifiedAtMs,
          rejection_code AS rejectionCode,
          rejection_reason AS rejectionReason
        FROM pod_receipts
        WHERE delivery_id = ?
        ORDER BY COALESCE(verified_at_ms, issued_at_ms) DESC, issued_at_ms DESC
        LIMIT 1
      `,
      [deliveryId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      receiptId: asString(row.receiptId),
      challengeId: asString(row.challengeId),
      deliveryId: asString(row.deliveryId),
      status: asString(row.status),
      senderDeviceId: asString(row.senderDeviceId),
      recipientDeviceId: asOptionalString(row.recipientDeviceId),
      issuedAtMs: asNumber(row.issuedAtMs),
      expiresAtMs: asNumber(row.expiresAtMs),
      verifiedAtMs: asOptionalNumber(row.verifiedAtMs),
      rejectionCode: asOptionalString(row.rejectionCode),
      rejectionReason: asOptionalString(row.rejectionReason),
    };
  }

  private async persistRejectedReceipt(input: {
    db: DatabaseHandle;
    receiptId: string;
    challenge: PodChallengeWire;
    code: string;
    reason: string;
    actor: ActorInput;
    status?: 'signature_mismatch' | 'replay_rejected' | 'expired';
  }): Promise<void> {
    const status = input.status ?? mapCodeToReceiptStatus(input.code);

    await input.db.execute(
      `
        INSERT OR REPLACE INTO pod_receipts (
          receipt_id,
          delivery_id,
          challenge_id,
          status,
          sender_device_id,
          sender_user_id,
          sender_public_key_id,
          recipient_user_id,
          recipient_device_id,
          nonce,
          payload_hash,
          issued_at_ms,
          expires_at_ms,
          verified_at_ms,
          rejection_code,
          rejection_reason,
          receipt_blob,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.receiptId,
        input.challenge.deliveryId,
        input.challenge.challengeId,
        status,
        input.challenge.senderDeviceId,
        input.challenge.senderUserId,
        input.challenge.senderPublicKeyId,
        input.actor.userId,
        input.actor.deviceId,
        input.challenge.nonce,
        input.challenge.payloadHash,
        input.challenge.issuedAtMs,
        input.challenge.expiresAtMs,
        null,
        input.code,
        input.reason,
        null,
        JSON.stringify({
          rejectedByRole: input.actor.role,
          rejectedAtMs: Date.now(),
        }),
      ],
    );

    await this.appendReceiptLedgerEvent({
      db: input.db,
      actor: input.actor,
      receiptId: input.receiptId,
      deliveryId: input.challenge.deliveryId,
      status:
        status === 'replay_rejected'
          ? 'replay-rejected'
          : status === 'expired'
            ? 'challenge-expired'
            : 'signature-mismatch',
      payloadType: 'digitaldelta.v1.pod.rejection',
      payloadBlob: undefined,
      metadata: {
        challengeId: input.challenge.challengeId,
        rejectionCode: input.code,
        rejectionReason: input.reason,
      },
    });
  }

  private async appendReceiptLedgerEvent(input: {
    db: DatabaseHandle;
    actor: ActorInput;
    receiptId: string;
    deliveryId: string;
    status: PodVerificationState;
    payloadType: string;
    payloadBlob?: Uint8Array;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const ledgerService = createSQLiteLedgerService(async () => input.db);
    const previousClock = await ledgerService.getLatestVectorClockForDevice(
      input.actor.deviceId,
    );

    await ledgerService.appendEvent({
      eventId: createIdentifier('evt-pod'),
      entityType: 'receipt',
      entityId: input.receiptId,
      eventType: 'pod_receipt',
      actor: {
        userId: input.actor.userId,
        deviceId: input.actor.deviceId,
        role: input.actor.role,
      },
      occurredAtMs: Date.now(),
      vectorClock: tickVectorClock(previousClock, input.actor.deviceId),
      payloadType: input.payloadType,
      payloadBlob: input.payloadBlob,
      metadata: {
        ...input.metadata,
        deliveryId: input.deliveryId,
        status: input.status,
      },
    });
  }
}

async function computeDeliveryPayloadHash(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<{ hashHex: string; hashBytes: Uint8Array }> {
  const deliveryResult = await db.execute(
    `
      SELECT
        delivery_id AS deliveryId,
        origin_node_id AS originNodeId,
        destination_node_id AS destinationNodeId,
        priority_tier AS priorityTier,
        status
      FROM deliveries
      WHERE delivery_id = ?
      LIMIT 1
    `,
    [deliveryId],
  );
  const deliveryRow = deliveryResult.rows[0];

  const cargoResult = await db.execute(
    `
      SELECT
        cargo_id AS cargoId,
        item_name AS itemName,
        quantity,
        unit,
        priority_tier AS priorityTier,
        weight_grams AS weightGrams,
        status
      FROM cargo_items
      WHERE delivery_id = ?
      ORDER BY cargo_id ASC
    `,
    [deliveryId],
  );

  const manifest = {
    deliveryId,
    originNodeId: asOptionalString(deliveryRow?.originNodeId),
    destinationNodeId: asOptionalString(deliveryRow?.destinationNodeId),
    priorityTier: asOptionalString(deliveryRow?.priorityTier),
    status: asOptionalString(deliveryRow?.status),
    cargo: cargoResult.rows.map(row => ({
      cargoId: asString(row.cargoId),
      itemName: asString(row.itemName),
      quantity: asNumber(row.quantity),
      unit: asString(row.unit),
      priorityTier: asString(row.priorityTier),
      weightGrams: asNumber(row.weightGrams),
      status: asString(row.status),
    })),
  };

  const serialized = JSON.stringify(manifest);
  return {
    hashHex: computeSha256Hex([serialized]),
    hashBytes: computeSha256Bytes([serialized]),
  };
}

async function ensureDeliveryExists(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<void> {
  const result = await db.execute(
    `
      SELECT delivery_id AS deliveryId
      FROM deliveries
      WHERE delivery_id = ?
      LIMIT 1
    `,
    [deliveryId],
  );

  if (!result.rows[0]) {
    throw new Error(`Delivery ${deliveryId} was not found.`);
  }
}

async function loadDeviceIdentity(
  db: DatabaseHandle,
  deviceId: string,
  required = true,
): Promise<
  | {
      deviceId: string;
      publicKeyPem: string;
      keyFingerprint: string;
      roles: AppRole[];
    }
  | null
> {
  const result = await db.execute(
    `
      SELECT
        device_id AS deviceId,
        public_key_pem AS publicKeyPem,
        key_fingerprint AS keyFingerprint,
        roles_json AS rolesJson
      FROM device_identity
      WHERE device_id = ?
      LIMIT 1
    `,
    [deviceId],
  );
  const row = result.rows[0];

  if (!row) {
    if (required) {
      throw new Error(`Device identity ${deviceId} not found.`);
    }

    return null;
  }

  return {
    deviceId: asString(row.deviceId),
    publicKeyPem: asString(row.publicKeyPem),
    keyFingerprint: asString(row.keyFingerprint),
    roles: parseRoles(row.rolesJson),
  };
}

async function findReceiptByChallengeId(
  db: DatabaseHandle,
  challengeId: string,
): Promise<{ receiptId: string; status: string } | null> {
  const result = await db.execute(
    `
      SELECT
        receipt_id AS receiptId,
        status
      FROM pod_receipts
      WHERE challenge_id = ?
      LIMIT 1
    `,
    [challengeId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    receiptId: asString(row.receiptId),
    status: asString(row.status),
  };
}

function clampExpiryMs(expiresInMs: number | undefined): number {
  const fallback = 3 * 60 * 1000;
  if (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs)) {
    return fallback;
  }

  return Math.max(45_000, Math.min(10 * 60 * 1000, Math.floor(expiresInMs)));
}

function mapCodeToReceiptStatus(
  code: string,
): 'signature_mismatch' | 'replay_rejected' | 'expired' {
  if (code === 'REPLAY_NONCE_USED') {
    return 'replay_rejected';
  }

  if (code === 'CHALLENGE_EXPIRED') {
    return 'expired';
  }

  return 'signature_mismatch';
}

function parseRoles(value: Scalar): AppRole[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(entry => (typeof entry === 'string' ? normalizeRole(entry) : null))
      .filter((entry): entry is AppRole => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeRole(value: string): AppRole | null {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'FIELD_VOLUNTEER':
    case 'SUPPLY_MANAGER':
    case 'DRONE_OPERATOR':
    case 'CAMP_COMMANDER':
    case 'SYNC_ADMIN':
      return normalized;
    default:
      return null;
  }
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asString(value: Scalar): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar): string | undefined {
  const resolved = asString(value);
  return resolved.length > 0 ? resolved : undefined;
}

function asNumber(value: Scalar): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function asOptionalNumber(value: Scalar): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
