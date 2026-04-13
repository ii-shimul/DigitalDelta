import type { Migration } from '../types';

export const meshPeersMigration: Migration = {
  id: 10,
  name: 'mesh_peers',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_peers (
        device_id TEXT PRIMARY KEY,
        x25519_pub_hex TEXT NOT NULL,
        display_name TEXT,
        last_seen_ms INTEGER NOT NULL,
        discovered_via TEXT NOT NULL DEFAULT 'ble'
      ) WITHOUT ROWID
      `,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mesh_peers_last_seen
       ON mesh_peers(last_seen_ms DESC)`,
    ],
  ],
};
