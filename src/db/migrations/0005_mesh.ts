import type { Migration } from '../types';

export const meshMigration: Migration = {
  id: 5,
  name: 'mesh_store_forward',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_messages (
        message_id TEXT PRIMARY KEY,
        origin_device_id TEXT NOT NULL,
        destination_device_id TEXT NOT NULL,
        relay_device_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        ttl_hops INTEGER NOT NULL DEFAULT 3,
        hop_count INTEGER NOT NULL DEFAULT 0,
        dedup_key TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL DEFAULT 'text/plain',
        nonce_hex TEXT NOT NULL,
        ciphertext_hex TEXT NOT NULL,
        sender_pub_x25519_hex TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        delivered_at_ms INTEGER,
        plaintext_preview TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
      `,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mesh_messages_status
       ON mesh_messages(status, expires_at_ms)`,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_node_log (
        log_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        role TEXT NOT NULL,
        battery_percent INTEGER NOT NULL,
        signal_dbm INTEGER NOT NULL,
        reason TEXT NOT NULL,
        logged_at_ms INTEGER NOT NULL
      ) WITHOUT ROWID
      `,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mesh_node_log_device
       ON mesh_node_log(device_id, logged_at_ms DESC)`,
    ],
  ],
};
