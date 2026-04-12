import type { Migration } from '../types';

export const fleetMigration: Migration = {
  id: 8,
  name: 'fleet',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS drone_handoffs (
        handoff_id           TEXT PRIMARY KEY,
        delivery_id          TEXT,
        vehicle_node_id      TEXT NOT NULL,
        vehicle_type         TEXT NOT NULL,
        drone_base_node_id   TEXT NOT NULL,
        dest_node_id         TEXT NOT NULL,
        rendezvous_node_id   TEXT,
        rendezvous_lat       REAL,
        rendezvous_lng       REAL,
        vehicle_eta_minutes  REAL,
        drone_eta_minutes    REAL,
        payload_weight_kg    REAL NOT NULL DEFAULT 5,
        drone_max_minutes    REAL NOT NULL DEFAULT 45,
        status               TEXT NOT NULL DEFAULT 'computed',
        pod_receipt_id       TEXT,
        scenario_label       TEXT,
        created_at_ms        INTEGER NOT NULL
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS battery_throttle_log (
        log_id               TEXT PRIMARY KEY,
        device_id            TEXT NOT NULL,
        simulated_time_ms    INTEGER NOT NULL,
        battery_pct          REAL NOT NULL,
        is_stationary        INTEGER NOT NULL DEFAULT 0,
        nearby_nodes_count   INTEGER NOT NULL DEFAULT 0,
        broadcast_interval_ms INTEGER NOT NULL,
        reduction_pct        REAL NOT NULL,
        reason               TEXT,
        logged_at_ms         INTEGER NOT NULL
      ) WITHOUT ROWID
      `,
    ],
  ],
};
