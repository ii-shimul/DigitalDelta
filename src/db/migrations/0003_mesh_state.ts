import type { Migration } from '../types';

export const meshStateMigration: Migration = {
  id: 3,
  name: 'mesh_state',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_node_state (
        device_id TEXT PRIMARY KEY,
        current_role TEXT NOT NULL DEFAULT 'client',
        relay_score REAL NOT NULL DEFAULT 0,
        battery_percent INTEGER,
        signal_strength INTEGER,
        nearby_peer_count INTEGER NOT NULL DEFAULT 0,
        last_role_changed_at_ms INTEGER,
        last_evaluated_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_seen_envelopes (
        owner_device_id TEXT NOT NULL,
        packet_id TEXT NOT NULL,
        sender_device_id TEXT NOT NULL,
        recipient_device_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        hop_count INTEGER NOT NULL DEFAULT 0,
        ttl_hops INTEGER NOT NULL DEFAULT 0,
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (owner_device_id, packet_id)
      )
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_store_queue (
        queue_id TEXT PRIMARY KEY,
        owner_device_id TEXT NOT NULL,
        packet_id TEXT NOT NULL,
        sender_device_id TEXT NOT NULL,
        recipient_device_id TEXT NOT NULL,
        next_hop_device_id TEXT,
        ttl_hops INTEGER NOT NULL,
        hop_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        packet_blob BLOB NOT NULL,
        payload_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_attempt_at_ms INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(owner_device_id, packet_id)
      )
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS mesh_relay_log (
        log_id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL,
        owner_device_id TEXT NOT NULL,
        action TEXT NOT NULL,
        from_peer_device_id TEXT,
        to_peer_device_id TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        occurred_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_mesh_node_state_role ON mesh_node_state(current_role, last_evaluated_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_mesh_seen_status_time ON mesh_seen_envelopes(owner_device_id, status, last_seen_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_mesh_store_queue_owner_status ON mesh_store_queue(owner_device_id, status, updated_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_mesh_store_queue_next_hop ON mesh_store_queue(next_hop_device_id, status, updated_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_mesh_relay_log_owner_time ON mesh_relay_log(owner_device_id, occurred_at_ms DESC)',
    ],
  ],
};
