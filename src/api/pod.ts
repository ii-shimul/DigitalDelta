import * as nacl from 'tweetnacl';
import { getDatabase } from '../db';
import type { RegisteredUser } from './auth';
import { getLocalDeviceSeed } from './auth';
import {
  bytesToHex,
  computeSha256Hex,
  encodeUtf8,
  hexToBytes,
  randomBytes,
} from '../core/auth/crypto';
import {
  type PodPayload,
  type SignedPodPayload,
  type VerifyResult,
  buildPodPayload,
  signPodPayload,
  verifyPodSignature,
} from '../core/pod/engine';

export type { PodPayload, SignedPodPayload, VerifyResult };

export type PodDelivery = {
  deliveryId: string;
  label: string;
  payloadHash: string;
  senderDeviceId: string;
  senderPubHex: string;
  recipientId: string | null;
  nonceHex: string;
  signatureHex: string | null;
  createdAtMs: number;
  status: 'pending' | 'signed' | 'verified' | 'completed';
  completedAtMs: number | null;
  qrPayload: string | null; // JSON string for QR
};

export type PodReceipt = {
  receiptId: string;
  deliveryId: string;
  senderDeviceId: string;
  senderSigHex: string;
  recipientDeviceId: string | null;
  recipientSigHex: string | null;
  payloadHash: string;
  nonceHex: string;
  issuedAtMs: number;
  verifiedAtMs: number | null;
  status: 'pending' | 'verified' | 'rejected';
};

// ─── Key helpers ─────────────────────────────────────────────────────────────

async function getSecretKey(user: RegisteredUser): Promise<Uint8Array | null> {
  // secretKey is seed (32) + publicKey (32) = 64 bytes stored in key vault
  const { createSecureDeviceKeyVault } = await import('../core/auth/key-vault');
  const vault = createSecureDeviceKeyVault();
  const material = await vault.get(user.deviceId);
  if (!material?.secretKeyHex) {
    return null;
  }
  return hexToBytes(material.secretKeyHex);
}

async function getPublicKeyHex(user: RegisteredUser): Promise<string | null> {
  const secretKey = await getSecretKey(user);
  if (!secretKey) {
    return null;
  }
  // Ed25519 secretKey = seed || publicKey (64 bytes), publicKey is last 32
  return bytesToHex(secretKey.slice(32));
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

function rowToDelivery(row: Record<string, unknown>): PodDelivery {
  return {
    deliveryId: row.delivery_id as string,
    label: row.label as string,
    payloadHash: row.payload_hash as string,
    senderDeviceId: row.sender_device_id as string,
    senderPubHex: row.sender_pub_hex as string,
    recipientId: (row.recipient_id as string | null) ?? null,
    nonceHex: row.nonce_hex as string,
    signatureHex: (row.signature_hex as string | null) ?? null,
    createdAtMs: row.created_at_ms as number,
    status: row.status as PodDelivery['status'],
    completedAtMs: (row.completed_at_ms as number | null) ?? null,
    qrPayload: null, // computed on demand
  };
}

function rowToReceipt(row: Record<string, unknown>): PodReceipt {
  return {
    receiptId: row.receipt_id as string,
    deliveryId: row.delivery_id as string,
    senderDeviceId: row.sender_device_id as string,
    senderSigHex: row.sender_sig_hex as string,
    recipientDeviceId: (row.recipient_device_id as string | null) ?? null,
    recipientSigHex: (row.recipient_sig_hex as string | null) ?? null,
    payloadHash: row.payload_hash as string,
    nonceHex: row.nonce_hex as string,
    issuedAtMs: row.issued_at_ms as number,
    verifiedAtMs: (row.verified_at_ms as number | null) ?? null,
    status: row.status as PodReceipt['status'],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getDeliveries(): Promise<PodDelivery[]> {
  const db = await getDatabase();
  const r = await db.execute(
    'SELECT * FROM pod_deliveries ORDER BY created_at_ms DESC LIMIT 30',
  );
  return r.rows.map(rowToDelivery);
}

export async function getReceipts(): Promise<PodReceipt[]> {
  const db = await getDatabase();
  const r = await db.execute(
    'SELECT * FROM pod_receipts ORDER BY issued_at_ms DESC LIMIT 30',
  );
  return r.rows.map(rowToReceipt);
}

/**
 * M5.1: Driver creates a signed QR payload for a delivery.
 * Returns the delivery record (qrPayload field = JSON string to encode as QR).
 */
export async function createSignedDelivery(
  user: RegisteredUser,
  params: { label: string; cargoDescription: string; recipientId: string },
): Promise<PodDelivery & { qrPayload: string }> {
  const db = await getDatabase();
  const secretKey = await getSecretKey(user);
  const pubHex = await getPublicKeyHex(user);
  if (!secretKey || !pubHex) {
    throw new Error('Key material unavailable. Please log in again.');
  }

  const deliveryId = `POD-${bytesToHex(randomBytes(5)).toUpperCase()}`;
  const payload = await buildPodPayload({
    deliveryId,
    label: params.label,
    cargoDescription: params.cargoDescription,
    senderPubHex: pubHex,
    recipientId: params.recipientId,
  });

  const signed = signPodPayload(payload, secretKey);
  const qrPayload = JSON.stringify(signed);
  const nowMs = Date.now();

  await db.execute(
    `INSERT INTO pod_deliveries
       (delivery_id, label, payload_hash, sender_device_id, sender_pub_hex,
        recipient_id, nonce_hex, signature_hex, created_at_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed')`,
    [
      deliveryId,
      params.label,
      payload.payload_hash,
      user.deviceId,
      pubHex,
      params.recipientId,
      payload.nonce,
      signed.signature,
      nowMs,
    ],
  );

  // NOTE: Nonce is NOT stored here — only the verifier (recipient) tracks
  // used nonces to detect replays (M5.2). The sender merely signs.

  return {
    deliveryId,
    label: params.label,
    payloadHash: payload.payload_hash,
    senderDeviceId: user.deviceId,
    senderPubHex: pubHex,
    recipientId: params.recipientId,
    nonceHex: payload.nonce,
    signatureHex: signed.signature,
    createdAtMs: nowMs,
    status: 'signed',
    completedAtMs: null,
    qrPayload,
  };
}

/**
 * M5.1 + M5.2: Recipient "scans" and verifies a signed PoD QR payload.
 * Checks: signature validity, nonce not previously used.
 * Returns a counter-signed receipt.
 */
export async function verifyAndCountersign(
  user: RegisteredUser,
  qrJson: string,
): Promise<{ result: VerifyResult; receiptId?: string }> {
  const db = await getDatabase();

  let signed: SignedPodPayload;
  try {
    signed = JSON.parse(qrJson) as SignedPodPayload;
  } catch {
    return { result: { ok: false, error: 'MALFORMED' } };
  }

  // M5.2: Replay check — nonce must not have been used before
  const nonceCheck = await db.execute(
    'SELECT nonce_hex FROM pod_used_nonces WHERE nonce_hex = ?',
    [signed.nonce],
  );
  if (nonceCheck.rows.length > 0) {
    return { result: { ok: false, error: 'REPLAY_DETECTED' } };
  }

  // Verify Ed25519 signature
  const verifyResult = verifyPodSignature(signed);
  if (!verifyResult.ok) {
    return { result: verifyResult };
  }

  const nowMs = Date.now();

  // Mark nonce as used
  await db.execute(
    `INSERT OR IGNORE INTO pod_used_nonces (nonce_hex, delivery_id, used_at_ms)
     VALUES (?, ?, ?)`,
    [signed.nonce, signed.delivery_id, nowMs],
  );

  // Recipient counter-signs the payload hash
  const secretKey = await getSecretKey(user);
  const recipientPubHex = await getPublicKeyHex(user);
  let recipientSigHex: string | null = null;
  if (secretKey && recipientPubHex) {
    const msgBytes = encodeUtf8(signed.payload_hash + signed.delivery_id);
    const sigBytes = nacl.sign.detached(msgBytes, secretKey);
    recipientSigHex = bytesToHex(sigBytes);
  }

  // Persist receipt (M5.3)
  const receiptId = `RCP-${bytesToHex(randomBytes(5)).toUpperCase()}`;
  await db.execute(
    `INSERT INTO pod_receipts
       (receipt_id, delivery_id, sender_device_id, sender_sig_hex,
        recipient_device_id, recipient_sig_hex, payload_hash, nonce_hex,
        issued_at_ms, verified_at_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')`,
    [
      receiptId,
      signed.delivery_id,
      signed.sender_pubkey.slice(0, 12), // use pub key prefix as sender id in demo
      signed.signature,
      user.deviceId,
      recipientSigHex,
      signed.payload_hash,
      signed.nonce,
      nowMs,
      nowMs,
    ],
  );

  // Update delivery status if it exists locally
  await db.execute(
    `UPDATE pod_deliveries SET status = 'completed', completed_at_ms = ?
     WHERE delivery_id = ?`,
    [nowMs, signed.delivery_id],
  );

  // M5.3: Append receipt to immutable audit trail + CRDT inventory ledger
  const logId = `POD-${bytesToHex(randomBytes(6)).toUpperCase()}`;
  const auditPayload = JSON.stringify({
    event: 'POD_DELIVERY_VERIFIED',
    receiptId,
    deliveryId: signed.delivery_id,
    label: signed.label,
    payloadHash: signed.payload_hash,
    senderPubKey: signed.sender_pubkey,
    recipientDeviceId: user.deviceId,
    ts: nowMs,
  });
  const payloadHash = computeSha256Hex([auditPayload]);
  const prev = await db.execute(
    'SELECT current_hash FROM auth_audit_log ORDER BY occurred_at_ms DESC LIMIT 1',
  );
  const previousHash = (prev.rows[0]?.current_hash as string | null) ?? null;
  const currentHash = computeSha256Hex([previousHash ?? '', payloadHash]);

  await db.execute(
    `INSERT INTO auth_audit_log
       (log_id, auth_event_id, event_type, user_id, device_id, previous_hash,
        payload_hash, current_hash, occurred_at_ms, event_blob, metadata_json)
     VALUES (?, ?, 'POD_DELIVERY_VERIFIED', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      receiptId,
      user.userId,
      user.deviceId,
      previousHash,
      payloadHash,
      currentHash,
      nowMs,
      auditPayload,
      JSON.stringify({ deliveryId: signed.delivery_id, label: signed.label }),
    ],
  );

  return { result: verifyResult, receiptId };
}

/**
 * M5.2: Attempt to replay the last verified QR — should be rejected.
 * Returns the last receipt's QR payload JSON for replay testing.
 */
export async function getLastSignedQrForReplay(): Promise<string | null> {
  const db = await getDatabase();
  const r = await db.execute(
    `SELECT d.delivery_id, d.label, d.payload_hash, d.sender_pub_hex,
            d.nonce_hex, d.signature_hex, d.recipient_id, d.created_at_ms
     FROM pod_deliveries d
     WHERE d.signature_hex IS NOT NULL
     ORDER BY d.created_at_ms DESC LIMIT 1`,
  );
  const row = r.rows[0];
  if (!row) {
    return null;
  }
  // Reconstruct the signed payload JSON
  const payload: SignedPodPayload = {
    delivery_id: row.delivery_id as string,
    sender_pubkey: row.sender_pub_hex as string,
    payload_hash: row.payload_hash as string,
    nonce: row.nonce_hex as string,
    timestamp: row.created_at_ms as number,
    label: row.label as string,
    recipient_id: (row.recipient_id as string | null) ?? '',
    signature: row.signature_hex as string,
  };
  return JSON.stringify(payload);
}
