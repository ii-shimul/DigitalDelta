import type { Migration } from '../types';

export const crdtConflictsMigration: Migration = {
  id: 4,
  name: 'crdt_conflicts',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS crdt_conflicts (
        conflict_id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        local_quantity INTEGER NOT NULL,
        remote_quantity INTEGER NOT NULL,
        local_clock_json TEXT NOT NULL,
        remote_clock_json TEXT NOT NULL,
        remote_device_id TEXT NOT NULL,
        detected_at_ms INTEGER NOT NULL,
        resolved_at_ms INTEGER,
        resolution_choice TEXT,
        resolved_quantity INTEGER
      ) WITHOUT ROWID
      `,
    ],
  ],
};
