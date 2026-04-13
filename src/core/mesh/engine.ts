/**
 * M3 – Ad-Hoc Mesh Network Engine
 *
 * Encryption: nacl.box (Curve25519 ECDH key agreement + XSalsa20-Poly1305 AEAD).
 * The Ed25519 seed is reused as the X25519 scalar — both curves share the
 * same secret-key space via nacl.box.keyPair.fromSecretKey(seed).
 *
 * This means a relay node that only has the ciphertext + nonce + sender-pubkey
 * CANNOT read the message — it needs the recipient's private seed.
 */
import * as nacl from 'tweetnacl';
import {
  bytesToHex,
  hexToBytes,
  encodeUtf8,
  decodeUtf8,
  randomBytes,
} from '../auth/crypto';

export type NodeRole = 'client' | 'relay';

export type MeshMessage = {
  messageId: string;
  originDeviceId: string;
  destinationDeviceId: string;
  relayDeviceId: string | null;
  status: 'pending' | 'in_transit' | 'delivered' | 'expired';
  ttlHops: number;
  hopCount: number;
  dedupKey: string;
  contentType: string;
  nonceHex: string;
  ciphertextHex: string;
  senderPubX25519Hex: string;
  createdAtMs: number;
  expiresAtMs: number;
  deliveredAtMs: number | null;
  plaintextPreview: string | null;
};

export type NodeRoleLogEntry = {
  logId: string;
  deviceId: string;
  role: NodeRole;
  batteryPercent: number;
  signalDbm: number;
  reason: string;
  loggedAtMs: number;
};

// ── Key derivation ────────────────────────────────────────────────────

/**
 * Derive an X25519 keypair from an Ed25519 seed (32 bytes).
 * nacl.box uses Curve25519, which shares the same secret-key bytes as
 * the Ed25519 seed.
 */
export function x25519KeyPairFromSeed(seed: Uint8Array): nacl.BoxKeyPair {
  return nacl.box.keyPair.fromSecretKey(seed);
}

// ── Encryption / Decryption ───────────────────────────────────────────

export type EncryptResult = {
  nonceHex: string;
  ciphertextHex: string;
  senderPubX25519Hex: string;
};

/**
 * Encrypt plaintext for a recipient.
 * @param plaintext - raw bytes to encrypt
 * @param senderSeed - sender's Ed25519 seed (32 bytes) – becomes X25519 secret
 * @param recipientX25519PubHex - hex of recipient's X25519 public key
 */
export function encryptForRecipient(
  plaintext: string | Uint8Array,
  senderSeed: Uint8Array,
  recipientX25519PubHex: string,
): EncryptResult {
  const senderKP = x25519KeyPairFromSeed(senderSeed);
  const recipientPub = hexToBytes(recipientX25519PubHex);
  const nonce = randomBytes(nacl.box.nonceLength);
  const message =
    typeof plaintext === 'string' ? encodeUtf8(plaintext) : plaintext;
  const ciphertext = nacl.box(message, nonce, recipientPub, senderKP.secretKey);

  return {
    nonceHex: bytesToHex(nonce),
    ciphertextHex: bytesToHex(ciphertext),
    senderPubX25519Hex: bytesToHex(senderKP.publicKey),
  };
}

/**
 * Decrypt a message. Returns null if decryption fails (wrong key or tampered).
 * @param ciphertextHex - hex ciphertext from EncryptResult
 * @param nonceHex - hex nonce
 * @param senderPubX25519Hex - sender's X25519 public key (from the message)
 * @param recipientSeed - recipient's Ed25519 seed (32 bytes)
 */
export function decryptFromSender(
  ciphertextHex: string,
  nonceHex: string,
  senderPubX25519Hex: string,
  recipientSeed: Uint8Array,
): string | null {
  const recipientKP = x25519KeyPairFromSeed(recipientSeed);
  const ciphertext = hexToBytes(ciphertextHex);
  const nonce = hexToBytes(nonceHex);
  const senderPub = hexToBytes(senderPubX25519Hex);

  const plaintext = nacl.box.open(
    ciphertext,
    nonce,
    senderPub,
    recipientKP.secretKey,
  );

  if (!plaintext) {
    return null;
  }

  return decodeUtf8(plaintext);
}

/**
 * Derive the X25519 public key hex from an Ed25519 seed.
 * Used to publish a device's encryption public key.
 */
export function x25519PubHexFromSeed(seed: Uint8Array): string {
  return bytesToHex(x25519KeyPairFromSeed(seed).publicKey);
}

// ── Message lifecycle ─────────────────────────────────────────────────

const MESSAGE_TTL_HOPS = 3;
const MESSAGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function buildMeshMessage(
  originDeviceId: string,
  destinationDeviceId: string,
  encrypt: EncryptResult,
  contentType = 'text/plain',
  messageId?: string,
): MeshMessage {
  const id = messageId ?? `MSG-${bytesToHex(randomBytes(6)).toUpperCase()}`;
  const nowMs = Date.now();
  return {
    messageId: id,
    originDeviceId,
    destinationDeviceId,
    relayDeviceId: null,
    status: 'pending',
    ttlHops: MESSAGE_TTL_HOPS,
    hopCount: 0,
    dedupKey: id, // message_id is the dedup key by default
    contentType,
    nonceHex: encrypt.nonceHex,
    ciphertextHex: encrypt.ciphertextHex,
    senderPubX25519Hex: encrypt.senderPubX25519Hex,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + MESSAGE_TTL_MS,
    deliveredAtMs: null,
    plaintextPreview: null,
  };
}

/**
 * Simulate a relay hop. Decrements TTL, increments hop count.
 * Returns null if TTL is exhausted or message is expired.
 */
export function applyRelayHop(
  msg: MeshMessage,
  relayDeviceId: string,
  nowMs = Date.now(),
): MeshMessage | null {
  if (msg.ttlHops <= 1 || nowMs > msg.expiresAtMs) {
    return null; // expired
  }
  return {
    ...msg,
    relayDeviceId,
    ttlHops: msg.ttlHops - 1,
    hopCount: msg.hopCount + 1,
    status: 'in_transit',
  };
}

// ── Role switching ────────────────────────────────────────────────────

/**
 * Determine node role based on battery level and signal strength.
 *
 * Rules (matches M3.2 heuristics):
 *  - battery < 30% OR signal < -80 dBm  → CLIENT  (conserve power)
 *  - battery ≥ 50% AND signal ≥ -70 dBm → RELAY   (capable node)
 *  - otherwise                           → RELAY   (default – help the mesh)
 */
export function computeNodeRole(
  batteryPercent: number,
  signalDbm: number,
): { role: NodeRole; reason: string } {
  if (batteryPercent < 30) {
    return {
      role: 'client',
      reason: `Battery low (${batteryPercent}%) – switching to CLIENT to conserve power`,
    };
  }
  if (signalDbm < -80) {
    return {
      role: 'client',
      reason: `Weak signal (${signalDbm} dBm) – switching to CLIENT`,
    };
  }
  if (batteryPercent >= 50 && signalDbm >= -70) {
    return {
      role: 'relay',
      reason: `Good battery (${batteryPercent}%) and signal (${signalDbm} dBm) – acting as RELAY`,
    };
  }
  return {
    role: 'relay',
    reason: `Adequate conditions – acting as RELAY`,
  };
}

// ── Protobuf Wire Format (C1 Mandatory) ──────────────────────────────
// All mesh relay communication uses Protobuf. JSON on the mesh wire is forbidden.

/** 4-byte magic prefix distinguishes mesh packets from CRDT sync deltas on BLE */
export const MESH_MAGIC = new Uint8Array([0x4d, 0x45, 0x53, 0x48]); // "MESH"

const MESH_PROTO_SCHEMA = `
syntax = "proto3";
package digitaldelta.v1;

message MeshPacketWire {
  string message_id = 1;
  string origin_device_id = 2;
  string destination_device_id = 3;
  string relay_device_id = 4;
  uint32 ttl_hops = 5;
  uint32 hop_count = 6;
  string dedup_key = 7;
  string content_type = 8;
  bytes nonce = 9;
  bytes ciphertext = 10;
  bytes sender_pub_x25519 = 11;
  uint64 created_at_ms = 12;
  uint64 expires_at_ms = 13;
  string sender_role = 14;
}

message MeshBundle {
  repeated MeshPacketWire packets = 1;
  string relay_node_id = 2;
  string relay_node_role = 3;
  uint64 timestamp_ms = 4;
  bytes relay_node_x25519_pub = 5;
}
`;

// ── Wire format types ─────────────────────────────────────────────────

export type MeshPacketWireType = {
  messageId: string;
  originDeviceId: string;
  destinationDeviceId: string;
  relayDeviceId: string;
  ttlHops: number;
  hopCount: number;
  dedupKey: string;
  contentType: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  senderPubX25519: Uint8Array;
  createdAtMs: number;
  expiresAtMs: number;
  senderRole: string;
};

export type MeshBundleType = {
  packets: MeshPacketWireType[];
  relayNodeId: string;
  relayNodeRole: string;
  timestampMs: number;
  relayNodeX25519Pub?: Uint8Array;
};

// ── Protobuf encode/decode ────────────────────────────────────────────

let _meshPbRoot: unknown = null;

async function getMeshPbRoot(): Promise<unknown> {
  if (_meshPbRoot) return _meshPbRoot;
  const protobuf = await import('protobufjs');
  _meshPbRoot = (protobuf.default ?? protobuf).parse(MESH_PROTO_SCHEMA).root;
  return _meshPbRoot;
}

/** Check if bytes start with MESH magic prefix */
export function hasMeshMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MESH_MAGIC.length) return false;
  for (let i = 0; i < MESH_MAGIC.length; i++) {
    if (bytes[i] !== MESH_MAGIC[i]) return false;
  }
  return true;
}

/** Convert a MeshMessage to Protobuf wire format */
export function meshMessageToWire(
  msg: MeshMessage,
  senderRole: NodeRole,
): MeshPacketWireType {
  return {
    messageId: msg.messageId,
    originDeviceId: msg.originDeviceId,
    destinationDeviceId: msg.destinationDeviceId,
    relayDeviceId: msg.relayDeviceId ?? '',
    ttlHops: msg.ttlHops,
    hopCount: msg.hopCount,
    dedupKey: msg.dedupKey,
    contentType: msg.contentType,
    nonce: hexToBytes(msg.nonceHex),
    ciphertext: hexToBytes(msg.ciphertextHex),
    senderPubX25519: hexToBytes(msg.senderPubX25519Hex),
    createdAtMs: msg.createdAtMs,
    expiresAtMs: msg.expiresAtMs,
    senderRole,
  };
}

/** Convert Protobuf wire format back to MeshMessage */
export function wireToMeshMessage(wire: MeshPacketWireType): MeshMessage {
  const toBytes = (v: unknown): Uint8Array =>
    v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
  return {
    messageId: wire.messageId,
    originDeviceId: wire.originDeviceId,
    destinationDeviceId: wire.destinationDeviceId,
    relayDeviceId: wire.relayDeviceId || null,
    status: 'in_transit',
    ttlHops: wire.ttlHops,
    hopCount: wire.hopCount,
    dedupKey: wire.dedupKey,
    contentType: wire.contentType,
    nonceHex: bytesToHex(toBytes(wire.nonce)),
    ciphertextHex: bytesToHex(toBytes(wire.ciphertext)),
    senderPubX25519Hex: bytesToHex(toBytes(wire.senderPubX25519)),
    createdAtMs: Number(wire.createdAtMs),
    expiresAtMs: Number(wire.expiresAtMs),
    deliveredAtMs: null,
    plaintextPreview: null,
  };
}

/** Encode a MeshBundle to Protobuf bytes with MESH magic prefix */
export async function encodeMeshBundle(
  bundle: MeshBundleType,
): Promise<Uint8Array> {
  const root = (await getMeshPbRoot()) as {
    lookupType: (name: string) => {
      encode: (msg: unknown) => { finish: () => Uint8Array };
    };
  };
  const BundleType = root.lookupType('digitaldelta.v1.MeshBundle');
  const pbBytes = BundleType.encode(bundle).finish();
  const result = new Uint8Array(MESH_MAGIC.length + pbBytes.length);
  result.set(MESH_MAGIC, 0);
  result.set(pbBytes, MESH_MAGIC.length);
  return result;
}

/** Decode Protobuf bytes (strips MESH magic) to MeshBundle */
export async function decodeMeshBundle(
  bytes: Uint8Array,
): Promise<MeshBundleType> {
  const root = (await getMeshPbRoot()) as {
    lookupType: (name: string) => {
      decode: (bytes: Uint8Array) => MeshBundleType;
    };
  };
  const BundleType = root.lookupType('digitaldelta.v1.MeshBundle');
  const offset = hasMeshMagic(bytes) ? MESH_MAGIC.length : 0;
  return BundleType.decode(bytes.subarray(offset)) as MeshBundleType;
}
