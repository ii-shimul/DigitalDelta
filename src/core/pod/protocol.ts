import { Enum, Field, Root, Type, type Message } from 'protobufjs';

import { encodeUtf8, decodeUtf8 } from '../auth/crypto';

export type PodSignatureWire = {
  algorithm: 'ED25519';
  signature: Uint8Array;
  keyId: string;
};

export type PodChallengeWire = {
  challengeId: string;
  deliveryId: string;
  senderDeviceId: string;
  senderUserId: string;
  senderPublicKeyId: string;
  payloadHash: Uint8Array;
  nonce: Uint8Array;
  issuedAtMs: number;
  expiresAtMs: number;
  senderSignature?: PodSignatureWire;
};

export type PodReceiptStatusWire =
  | 'CHALLENGE_CREATED'
  | 'COUNTERSIGNED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'REPLAY_REJECTED';

export type PodReceiptWire = {
  receiptId: string;
  deliveryId: string;
  status: PodReceiptStatusWire;
  challenge: PodChallengeWire;
  recipientUserId?: string;
  recipientDeviceId?: string;
  recipientSignature?: PodSignatureWire;
  verifiedAtMs?: number;
  rejectionCode?: string;
  rejectionReason?: string;
};

const root = new Root();

const SignatureAlgorithmEnum = new Enum('SignatureAlgorithm', {
  SIGNATURE_ALGORITHM_UNSPECIFIED: 0,
  SIGNATURE_ALGORITHM_RSA_SHA256: 1,
  SIGNATURE_ALGORITHM_ED25519: 2,
});

const PodReceiptStatusEnum = new Enum('PodReceiptStatus', {
  POD_RECEIPT_STATUS_UNSPECIFIED: 0,
  POD_RECEIPT_STATUS_CHALLENGE_CREATED: 1,
  POD_RECEIPT_STATUS_COUNTERSIGNED: 2,
  POD_RECEIPT_STATUS_VERIFIED: 3,
  POD_RECEIPT_STATUS_REJECTED: 4,
  POD_RECEIPT_STATUS_REPLAY_REJECTED: 5,
});

const SignatureMessage = new Type('Signature')
  .add(new Field('algorithm', 1, 'SignatureAlgorithm'))
  .add(new Field('signature', 2, 'bytes'))
  .add(new Field('key_id', 3, 'string'));

const PodChallengeMessage = new Type('PodChallenge')
  .add(new Field('challenge_id', 1, 'string'))
  .add(new Field('delivery_id', 2, 'string'))
  .add(new Field('sender_device_id', 3, 'string'))
  .add(new Field('sender_user_id', 4, 'string'))
  .add(new Field('sender_public_key_id', 5, 'string'))
  .add(new Field('payload_hash', 6, 'bytes'))
  .add(new Field('nonce', 7, 'bytes'))
  .add(new Field('issued_at_ms', 8, 'uint64'))
  .add(new Field('expires_at_ms', 9, 'uint64'))
  .add(new Field('sender_signature', 10, 'Signature'));

const PodReceiptMessage = new Type('PodReceipt')
  .add(new Field('receipt_id', 1, 'string'))
  .add(new Field('delivery_id', 2, 'string'))
  .add(new Field('status', 3, 'PodReceiptStatus'))
  .add(new Field('challenge', 4, 'PodChallenge'))
  .add(new Field('recipient_user_id', 5, 'string'))
  .add(new Field('recipient_device_id', 6, 'string'))
  .add(new Field('recipient_signature', 7, 'Signature'))
  .add(new Field('verified_at_ms', 8, 'uint64'))
  .add(new Field('rejection_code', 9, 'string'))
  .add(new Field('rejection_reason', 10, 'string'));

root
  .define('digitaldelta.v1')
  .add(SignatureAlgorithmEnum)
  .add(PodReceiptStatusEnum)
  .add(SignatureMessage)
  .add(PodChallengeMessage)
  .add(PodReceiptMessage);

const PodReceiptStatusByName: Record<PodReceiptStatusWire, number> = {
  CHALLENGE_CREATED: 1,
  COUNTERSIGNED: 2,
  VERIFIED: 3,
  REJECTED: 4,
  REPLAY_REJECTED: 5,
};

const PodReceiptStatusById: Record<number, PodReceiptStatusWire> = {
  1: 'CHALLENGE_CREATED',
  2: 'COUNTERSIGNED',
  3: 'VERIFIED',
  4: 'REJECTED',
  5: 'REPLAY_REJECTED',
};

const SignatureAlgorithmByName: Record<PodSignatureWire['algorithm'], number> = {
  ED25519: 2,
};

const SignatureAlgorithmById: Record<number, PodSignatureWire['algorithm']> = {
  2: 'ED25519',
};

export function encodeUnsignedPodChallenge(challenge: {
  challengeId: string;
  deliveryId: string;
  senderDeviceId: string;
  senderUserId: string;
  senderPublicKeyId: string;
  payloadHash: Uint8Array;
  nonce: Uint8Array;
  issuedAtMs: number;
  expiresAtMs: number;
}): Uint8Array {
  const encoded = PodChallengeMessage.encode(
    PodChallengeMessage.create({
      challenge_id: challenge.challengeId,
      delivery_id: challenge.deliveryId,
      sender_device_id: challenge.senderDeviceId,
      sender_user_id: challenge.senderUserId,
      sender_public_key_id: challenge.senderPublicKeyId,
      payload_hash: challenge.payloadHash,
      nonce: challenge.nonce,
      issued_at_ms: challenge.issuedAtMs,
      expires_at_ms: challenge.expiresAtMs,
      sender_signature: undefined,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function encodePodChallenge(challenge: PodChallengeWire): Uint8Array {
  const encoded = PodChallengeMessage.encode(
    PodChallengeMessage.create({
      challenge_id: challenge.challengeId,
      delivery_id: challenge.deliveryId,
      sender_device_id: challenge.senderDeviceId,
      sender_user_id: challenge.senderUserId,
      sender_public_key_id: challenge.senderPublicKeyId,
      payload_hash: challenge.payloadHash,
      nonce: challenge.nonce,
      issued_at_ms: challenge.issuedAtMs,
      expires_at_ms: challenge.expiresAtMs,
      sender_signature: challenge.senderSignature
        ? toProtoSignature(challenge.senderSignature)
        : undefined,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodePodChallenge(encoded: Uint8Array): PodChallengeWire {
  const decoded = PodChallengeMessage.decode(encoded) as Message<{
    challenge_id?: string;
    delivery_id?: string;
    sender_device_id?: string;
    sender_user_id?: string;
    sender_public_key_id?: string;
    payload_hash?: Uint8Array;
    nonce?: Uint8Array;
    issued_at_ms?: unknown;
    expires_at_ms?: unknown;
    sender_signature?: unknown;
  }>;
  const plain = PodChallengeMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  return {
    challengeId: asString(plain.challenge_id),
    deliveryId: asString(plain.delivery_id),
    senderDeviceId: asString(plain.sender_device_id),
    senderUserId: asString(plain.sender_user_id),
    senderPublicKeyId: asString(plain.sender_public_key_id),
    payloadHash: asBytes(plain.payload_hash) ?? new Uint8Array(),
    nonce: asBytes(plain.nonce) ?? new Uint8Array(),
    issuedAtMs: asNumber(plain.issued_at_ms),
    expiresAtMs: asNumber(plain.expires_at_ms),
    senderSignature: plain.sender_signature
      ? fromProtoSignature(plain.sender_signature)
      : undefined,
  };
}

export function encodePodReceipt(receipt: PodReceiptWire): Uint8Array {
  const encoded = PodReceiptMessage.encode(
    PodReceiptMessage.create({
      receipt_id: receipt.receiptId,
      delivery_id: receipt.deliveryId,
      status: PodReceiptStatusByName[receipt.status],
      challenge: {
        challenge_id: receipt.challenge.challengeId,
        delivery_id: receipt.challenge.deliveryId,
        sender_device_id: receipt.challenge.senderDeviceId,
        sender_user_id: receipt.challenge.senderUserId,
        sender_public_key_id: receipt.challenge.senderPublicKeyId,
        payload_hash: receipt.challenge.payloadHash,
        nonce: receipt.challenge.nonce,
        issued_at_ms: receipt.challenge.issuedAtMs,
        expires_at_ms: receipt.challenge.expiresAtMs,
        sender_signature: receipt.challenge.senderSignature
          ? toProtoSignature(receipt.challenge.senderSignature)
          : undefined,
      },
      recipient_user_id: receipt.recipientUserId,
      recipient_device_id: receipt.recipientDeviceId,
      recipient_signature: receipt.recipientSignature
        ? toProtoSignature(receipt.recipientSignature)
        : undefined,
      verified_at_ms: receipt.verifiedAtMs,
      rejection_code: receipt.rejectionCode,
      rejection_reason: receipt.rejectionReason,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodePodReceipt(encoded: Uint8Array): PodReceiptWire {
  const decoded = PodReceiptMessage.decode(encoded) as Message<{
    receipt_id?: string;
    delivery_id?: string;
    status?: number | string;
    challenge?: unknown;
    recipient_user_id?: string;
    recipient_device_id?: string;
    recipient_signature?: unknown;
    verified_at_ms?: unknown;
    rejection_code?: string;
    rejection_reason?: string;
  }>;
  const plain = PodReceiptMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  const statusId =
    typeof plain.status === 'number'
      ? plain.status
      : Number(plain.status ?? 0) || 0;

  return {
    receiptId: asString(plain.receipt_id),
    deliveryId: asString(plain.delivery_id),
    status: PodReceiptStatusById[statusId] ?? 'REJECTED',
    challenge: fromProtoChallenge(plain.challenge),
    recipientUserId: asOptionalString(plain.recipient_user_id),
    recipientDeviceId: asOptionalString(plain.recipient_device_id),
    recipientSignature: plain.recipient_signature
      ? fromProtoSignature(plain.recipient_signature)
      : undefined,
    verifiedAtMs: asOptionalNumber(plain.verified_at_ms),
    rejectionCode: asOptionalString(plain.rejection_code),
    rejectionReason: asOptionalString(plain.rejection_reason),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += alphabet[(chunk >> 18) & 0x3f];
    output += alphabet[(chunk >> 12) & 0x3f];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 0x3f] : '=';
    output += index + 2 < bytes.length ? alphabet[chunk & 0x3f] : '=';
  }

  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s/g, '');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];

  for (let index = 0; index < cleaned.length; index += 4) {
    const a = alphabet.indexOf(cleaned[index] ?? 'A');
    const b = alphabet.indexOf(cleaned[index + 1] ?? 'A');
    const c =
      cleaned[index + 2] === '='
        ? -1
        : alphabet.indexOf(cleaned[index + 2] ?? 'A');
    const d =
      cleaned[index + 3] === '='
        ? -1
        : alphabet.indexOf(cleaned[index + 3] ?? 'A');

    const chunk =
      ((a & 0x3f) << 18) |
      ((b & 0x3f) << 12) |
      ((Math.max(c, 0) & 0x3f) << 6) |
      (Math.max(d, 0) & 0x3f);

    output.push((chunk >> 16) & 0xff);
    if (c >= 0) {
      output.push((chunk >> 8) & 0xff);
    }
    if (d >= 0) {
      output.push(chunk & 0xff);
    }
  }

  return new Uint8Array(output);
}

export function encodeQrPayload(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function decodeQrPayload(payload: string): Uint8Array {
  return base64ToBytes(payload);
}

export function encodeRecipientSigningPayload(input: {
  challengeBytes: Uint8Array;
  recipientUserId: string;
  recipientDeviceId: string;
  verifiedAtMs: number;
}): Uint8Array {
  const prefix = encodeUtf8('digitaldelta.v1.pod.receipt.signing');
  const metadata = encodeUtf8(
    JSON.stringify({
      recipientUserId: input.recipientUserId,
      recipientDeviceId: input.recipientDeviceId,
      verifiedAtMs: input.verifiedAtMs,
    }),
  );

  const merged = new Uint8Array(
    prefix.length + input.challengeBytes.length + metadata.length,
  );
  merged.set(prefix, 0);
  merged.set(input.challengeBytes, prefix.length);
  merged.set(metadata, prefix.length + input.challengeBytes.length);
  return merged;
}

export function decodeReceiptBlobForPreview(blob: Uint8Array): string {
  try {
    const receipt = decodePodReceipt(blob);
    return JSON.stringify(
      {
        receiptId: receipt.receiptId,
        challengeId: receipt.challenge.challengeId,
        status: receipt.status,
        recipientDeviceId: receipt.recipientDeviceId,
        rejectionCode: receipt.rejectionCode,
      },
      null,
      2,
    );
  } catch {
    return decodeUtf8(blob);
  }
}

function toProtoSignature(signature: PodSignatureWire): {
  algorithm: number;
  signature: Uint8Array;
  key_id: string;
} {
  return {
    algorithm: SignatureAlgorithmByName[signature.algorithm],
    signature: signature.signature,
    key_id: signature.keyId,
  };
}

function fromProtoSignature(value: unknown): PodSignatureWire {
  const record = asRecord(value);
  const numericAlgorithm =
    typeof record.algorithm === 'number'
      ? record.algorithm
      : Number(record.algorithm ?? 0) || 0;

  return {
    algorithm: SignatureAlgorithmById[numericAlgorithm] ?? 'ED25519',
    signature: asBytes(record.signature) ?? new Uint8Array(),
    keyId: asString(record.key_id),
  };
}

function fromProtoChallenge(value: unknown): PodChallengeWire {
  const record = asRecord(value);
  return {
    challengeId: asString(record.challenge_id),
    deliveryId: asString(record.delivery_id),
    senderDeviceId: asString(record.sender_device_id),
    senderUserId: asString(record.sender_user_id),
    senderPublicKeyId: asString(record.sender_public_key_id),
    payloadHash: asBytes(record.payload_hash) ?? new Uint8Array(),
    nonce: asBytes(record.nonce) ?? new Uint8Array(),
    issuedAtMs: asNumber(record.issued_at_ms),
    expiresAtMs: asNumber(record.expires_at_ms),
    senderSignature: record.sender_signature
      ? fromProtoSignature(record.sender_signature)
      : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}
