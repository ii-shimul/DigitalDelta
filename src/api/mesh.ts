import { getDatabase } from '../db';
import { bytesToHex, randomBytes } from '../core/auth/crypto';
import { getLocalDeviceSeed, getDeviceIdentity } from './auth';
import type { RegisteredUser } from './auth';
import {
  type MeshMessage,
  type NodeRole,
  type NodeRoleLogEntry,
  buildMeshMessage,
  applyRelayHop,
  computeNodeRole,
  encryptForRecipient,
  decryptFromSender,
  x25519PubHexFromSeed,
} from '../core/mesh/engine';

export type { MeshMessage, NodeRole, NodeRoleLogEntry };

function genId(prefix: string): string {
  return `${prefix}${bytesToHex(randomBytes(5)).toUpperCase()}`;
}

function rowToMessage(row: Record<string, unknown>): MeshMessage {
  return {
    messageId: row.message_id as string,
    originDeviceId: row.origin_device_id as string,
    destinationDeviceId: row.destination_device_id as string,
    relayDeviceId:
      row.relay_device_id != null ? (row.relay_device_id as string) : null,
    status: row.status as MeshMessage['status'],
    ttlHops: row.ttl_hops as number,
    hopCount: row.hop_count as number,
    dedupKey: row.dedup_key as string,
    contentType: row.content_type as string,
    nonceHex: row.nonce_hex as string,
    ciphertextHex: row.ciphertext_hex as string,
    senderPubX25519Hex: row.sender_pub_x25519_hex as string,
    createdAtMs: row.created_at_ms as number,
    expiresAtMs: row.expires_at_ms as number,
    deliveredAtMs:
      row.delivered_at_ms != null ? (row.delivered_at_ms as number) : null,
    plaintextPreview:
      row.plaintext_preview != null ? (row.plaintext_preview as string) : null,
  };
}

function rowToLog(row: Record<string, unknown>): NodeRoleLogEntry {
  return {
    logId: row.log_id as string,
    deviceId: row.device_id as string,
    role: row.role as NodeRole,
    batteryPercent: row.battery_percent as number,
    signalDbm: row.signal_dbm as number,
    reason: row.reason as string,
    loggedAtMs: row.logged_at_ms as number,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function getMeshMessages(): Promise<MeshMessage[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mesh_messages ORDER BY created_at_ms DESC LIMIT 50`,
  );
  return result.rows.map(r => rowToMessage(r as Record<string, unknown>));
}

export async function getNodeRoleLog(): Promise<NodeRoleLogEntry[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mesh_node_log ORDER BY logged_at_ms DESC LIMIT 30`,
  );
  return result.rows.map(r => rowToLog(r as Record<string, unknown>));
}

export async function getCurrentRole(
  deviceId: string,
): Promise<NodeRoleLogEntry | null> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mesh_node_log WHERE device_id = ? ORDER BY logged_at_ms DESC LIMIT 1`,
    [deviceId],
  );
  const row = result.rows[0];
  return row ? rowToLog(row as Record<string, unknown>) : null;
}

// ── Role management ─────────────────────────────────────────────────────

export async function evaluateAndLogRole(
  user: RegisteredUser,
  batteryPercent: number,
  signalDbm: number,
): Promise<NodeRoleLogEntry> {
  const db = await getDatabase();
  const { role, reason } = computeNodeRole(batteryPercent, signalDbm);
  const logId = genId('ROLE-');
  const nowMs = Date.now();
  await db.execute(
    `INSERT INTO mesh_node_log (log_id, device_id, role, battery_percent, signal_dbm, reason, logged_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [logId, user.deviceId, role, batteryPercent, signalDbm, reason, nowMs],
  );
  return {
    logId,
    deviceId: user.deviceId,
    role,
    batteryPercent,
    signalDbm,
    reason,
    loggedAtMs: nowMs,
  };
}

// ── Messaging ───────────────────────────────────────────────────────────

export type SendMessageInput = {
  text: string;
  /**
   * Destination device ID. Pass user.deviceId to send-to-self (demo: verify decryption).
   * Pass a virtual device ID to simulate relay across the mesh.
   */
  destinationDeviceId: string;
  /**
   * X25519 public key hex of the destination device.
   * If omitted and destinationDeviceId === user.deviceId, derived from local seed.
   */
  destinationX25519PubHex?: string;
};

export async function sendMeshMessage(
  user: RegisteredUser,
  input: SendMessageInput,
): Promise<MeshMessage> {
  const db = await getDatabase();

  // Get sender seed
  const senderSeed = await getLocalDeviceSeed(user.deviceId);
  if (!senderSeed) {
    throw new Error('Local device key material unavailable');
  }

  // Get destination X25519 public key
  let recipientX25519PubHex = input.destinationX25519PubHex;
  if (!recipientX25519PubHex && input.destinationDeviceId === user.deviceId) {
    // Self-send demo: derive from same seed
    recipientX25519PubHex = x25519PubHexFromSeed(senderSeed);
  }
  if (!recipientX25519PubHex) {
    throw new Error('Recipient public key required for non-self destinations');
  }

  const encrypted = encryptForRecipient(
    input.text,
    senderSeed,
    recipientX25519PubHex,
  );
  const msg = buildMeshMessage(
    user.deviceId,
    input.destinationDeviceId,
    encrypted,
  );

  await db.execute(
    `INSERT INTO mesh_messages
     (message_id, origin_device_id, destination_device_id, relay_device_id,
      status, ttl_hops, hop_count, dedup_key, content_type,
      nonce_hex, ciphertext_hex, sender_pub_x25519_hex,
      created_at_ms, expires_at_ms, metadata_json)
     VALUES (?, ?, ?, NULL, 'pending', ?, 0, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    [
      msg.messageId,
      msg.originDeviceId,
      msg.destinationDeviceId,
      msg.ttlHops,
      msg.dedupKey,
      msg.contentType,
      msg.nonceHex,
      msg.ciphertextHex,
      msg.senderPubX25519Hex,
      msg.createdAtMs,
      msg.expiresAtMs,
    ],
  );
  return msg;
}

/**
 * Simulate a relay hop. A virtual relay device "picks up" all pending messages
 * destined for other nodes (not the relay itself) and forwards them.
 *
 * Returns the number of messages relayed/expired.
 */
export async function simulateRelayHop(
  user: RegisteredUser,
): Promise<{ relayed: number; expired: number; relayDeviceId: string }> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mesh_messages WHERE status IN ('pending', 'in_transit') AND expires_at_ms > ?`,
    [Date.now()],
  );
  const messages = result.rows.map(r =>
    rowToMessage(r as Record<string, unknown>),
  );
  const relayDeviceId = genId('RELAY-');
  let relayed = 0;
  let expired = 0;

  for (const msg of messages) {
    // A relay should not forward messages it originated (avoid loops)
    if (msg.originDeviceId === user.deviceId) {
      // Check for dedup before relaying
      const afterHop = applyRelayHop(msg, relayDeviceId);
      if (!afterHop) {
        await db.execute(
          `UPDATE mesh_messages SET status = 'expired' WHERE message_id = ?`,
          [msg.messageId],
        );
        expired++;
      } else {
        await db.execute(
          `UPDATE mesh_messages
           SET relay_device_id = ?, status = ?, ttl_hops = ?, hop_count = ?
           WHERE message_id = ?`,
          [
            afterHop.relayDeviceId,
            afterHop.status,
            afterHop.ttlHops,
            afterHop.hopCount,
            msg.messageId,
          ],
        );
        relayed++;
      }
    }
  }

  return { relayed, expired, relayDeviceId };
}

/**
 * Attempt to deliver all in-transit messages destined for this device.
 * Decrypts each one and stores the plaintext preview.
 */
export async function deliverIncomingMessages(
  user: RegisteredUser,
): Promise<{ delivered: number; failed: number }> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mesh_messages
     WHERE destination_device_id = ? AND status IN ('pending', 'in_transit')`,
    [user.deviceId],
  );
  const messages = result.rows.map(r =>
    rowToMessage(r as Record<string, unknown>),
  );

  const seed = await getLocalDeviceSeed(user.deviceId);
  let delivered = 0;
  let failed = 0;

  for (const msg of messages) {
    if (!seed) {
      failed += messages.length;
      break;
    }
    const plaintext = decryptFromSender(
      msg.ciphertextHex,
      msg.nonceHex,
      msg.senderPubX25519Hex,
      seed,
    );
    const nowMs = Date.now();
    if (plaintext !== null) {
      await db.execute(
        `UPDATE mesh_messages
         SET status = 'delivered', delivered_at_ms = ?, plaintext_preview = ?
         WHERE message_id = ?`,
        [nowMs, plaintext, msg.messageId],
      );
      delivered++;
    } else {
      await db.execute(
        `UPDATE mesh_messages SET status = 'expired' WHERE message_id = ?`,
        [msg.messageId],
      );
      failed++;
    }
  }
  return { delivered, failed };
}

/**
 * Expire all messages that have passed their TTL deadline.
 */
export async function expireOldMessages(): Promise<number> {
  const db = await getDatabase();
  const result = await db.execute(
    `UPDATE mesh_messages SET status = 'expired'
     WHERE status IN ('pending', 'in_transit') AND expires_at_ms <= ?`,
    [Date.now()],
  );
  return result.rowsAffected ?? 0;
}

export async function getMeshStats(deviceId: string): Promise<{
  total: number;
  pending: number;
  inTransit: number;
  delivered: number;
  expired: number;
  currentRole: NodeRole | null;
}> {
  const db = await getDatabase();
  const counts = await db.execute(
    `SELECT status, COUNT(*) as c FROM mesh_messages GROUP BY status`,
  );
  const stats: Record<string, number> = {};
  for (const row of counts.rows) {
    stats[row.status as string] = row.c as number;
  }
  const totalResult = await db.execute(
    `SELECT COUNT(*) as c FROM mesh_messages`,
  );
  const roleEntry = await getCurrentRole(deviceId);
  return {
    total: ((totalResult.rows[0] as Record<string, unknown>)?.c as number) ?? 0,
    pending: stats['pending'] ?? 0,
    inTransit: stats['in_transit'] ?? 0,
    delivered: stats['delivered'] ?? 0,
    expired: stats['expired'] ?? 0,
    currentRole: roleEntry?.role ?? null,
  };
}
