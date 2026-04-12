import type { Migration } from '../types';

export const podMigration: Migration = {
  id: 7,
  name: 'pod',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS pod_deliveries (
        delivery_id     TEXT PRIMARY KEY,
        label           TEXT NOT NULL,
        payload_hash    TEXT NOT NULL,
        sender_device_id   TEXT NOT NULL,
        sender_pub_hex     TEXT NOT NULL,
        recipient_node_id  TEXT,
        nonce_hex       TEXT NOT NULL,
        signature_hex   TEXT,
        created_at_ms   INTEGER NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        completed_at_ms INTEGER
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS pod_receipts (
        receipt_id         TEXT PRIMARY KEY,
        delivery_id        TEXT NOT NULL,
        sender_device_id   TEXT NOT NULL,
        sender_sig_hex     TEXT NOT NULL,
        recipient_device_id TEXT,
        recipient_sig_hex  TEXT,
        payload_hash       TEXT NOT NULL,
        nonce_hex          TEXT NOT NULL,
        issued_at_ms       INTEGER NOT NULL,
        verified_at_ms     INTEGER,
        status             TEXT NOT NULL DEFAULT 'pending'
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS pod_used_nonces (
        nonce_hex   TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        used_at_ms  INTEGER NOT NULL
      ) WITHOUT ROWID
      `,
    ],
  ],
};
