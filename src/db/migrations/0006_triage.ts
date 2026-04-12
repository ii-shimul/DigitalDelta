import type { Migration } from '../types';

export const triageMigration: Migration = {
  id: 6,
  name: 'triage',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS triage_cargo (
        cargo_id       TEXT PRIMARY KEY,
        label          TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        priority       TEXT NOT NULL,
        sla_window_ms  INTEGER NOT NULL,
        created_at_ms  INTEGER NOT NULL,
        eta_ms         INTEGER NOT NULL,
        route_slowdown_pct REAL NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'active',
        waypoint_label TEXT,
        resolved_at_ms INTEGER,
        device_id      TEXT NOT NULL
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS triage_decisions (
        decision_id   TEXT PRIMARY KEY,
        cargo_id      TEXT NOT NULL,
        decision_type TEXT NOT NULL,
        priority      TEXT NOT NULL,
        rationale     TEXT NOT NULL,
        waypoint      TEXT,
        decided_at_ms INTEGER NOT NULL,
        device_id     TEXT NOT NULL
      ) WITHOUT ROWID
      `,
    ],
  ],
};
