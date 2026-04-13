// Zero-Trust Proof-of-Delivery (PoD) engine
// Ed25519 sign/verify using tweetnacl; nonce tracking for replay protection

import * as nacl from 'tweetnacl';
import {
  bytesToHex,
  computeSha256Hex,
  hexToBytes,
  randomBytes,
} from '../auth/crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PodPayload = {
  delivery_id: string;
  sender_pubkey: string; // hex of Ed25519 public key
  payload_hash: string; // SHA-256 hex of cargo description
  nonce: string; // 16-byte hex, single-use
  timestamp: number; // ms since epoch
  label: string; // human-readable cargo label
  recipient_id: string; // nearby user/camp personnel ID
};

export type SignedPodPayload = PodPayload & {
  signature: string; // Ed25519 signature hex over canonical JSON
};

export type VerifyResult =
  | { ok: true; payload: SignedPodPayload }
  | {
      ok: false;
      error: 'INVALID_SIGNATURE' | 'REPLAY_DETECTED' | 'MALFORMED' | 'EXPIRED';
    };

// ─── Canonicalisation ─────────────────────────────────────────────────────────

/** Deterministic JSON for signing — sorted keys, no whitespace */
export function canonicalise(payload: PodPayload): string {
  const keys = Object.keys(payload).sort() as (keyof PodPayload)[];
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    obj[k] = payload[k];
  }
  return JSON.stringify(obj);
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Create and sign a PoD payload using the sender's Ed25519 secret key.
 * secretKey = 64-byte nacl secretKey (seed || publicKey).
 */
export function signPodPayload(
  payload: PodPayload,
  secretKey: Uint8Array,
): SignedPodPayload {
  const canonical = canonicalise(payload);
  const msgBytes = new TextEncoder().encode(canonical);
  const sigBytes = nacl.sign.detached(msgBytes, secretKey);
  return { ...payload, signature: bytesToHex(sigBytes) };
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a signed PoD payload.
 * Does NOT check nonce replay — that is the caller's responsibility (see pod.ts).
 */
export function verifyPodSignature(signed: SignedPodPayload): VerifyResult {
  try {
    const { signature, ...payload } = signed;
    const canonical = canonicalise(payload as PodPayload);
    const msgBytes = new TextEncoder().encode(canonical);
    const sigBytes = hexToBytes(signature);
    const pubKeyBytes = hexToBytes(signed.sender_pubkey);

    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
    if (!valid) {
      return { ok: false, error: 'INVALID_SIGNATURE' };
    }
    return { ok: true, payload: signed };
  } catch {
    return { ok: false, error: 'MALFORMED' };
  }
}

// ─── Build QR payload ─────────────────────────────────────────────────────────

export async function buildPodPayload(params: {
  deliveryId: string;
  label: string;
  cargoDescription: string;
  senderPubHex: string;
  recipientId: string;
}): Promise<PodPayload> {
  const payloadHash = await computeSha256Hex(params.cargoDescription);
  return {
    delivery_id: params.deliveryId,
    sender_pubkey: params.senderPubHex,
    payload_hash: payloadHash,
    nonce: bytesToHex(randomBytes(16)),
    timestamp: Date.now(),
    label: params.label,
    recipient_id: params.recipientId,
  };
}
