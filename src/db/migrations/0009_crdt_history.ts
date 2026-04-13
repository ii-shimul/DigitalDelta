import type { Migration } from '../types';

/**
 * Migration 9 – CRDT causal history + OR-Set tags
 *
 * mutation_history: every inventory mutation is recorded here so that
 *   the causal chain (A writes → B reads → B writes) can be replayed
 *   and visualised (M2.2).
 *
 * or_set_tags: each "add" of a supply item records a unique tag; a remove
 *   tombstones that specific tag without affecting concurrently added tags
 *   (OR-Set semantics, M2.1). An item is considered "alive" as long as at
 *   least one non-tombstoned tag exists.
 */
export const crdtHistoryMigration: Migration = {
  id: 9,
  name: 'crdt_history',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS mutation_history (
        mutation_id      TEXT    PRIMARY KEY,
        item_id          TEXT    NOT NULL,
        actor_device_id  TEXT    NOT NULL,
        event_type       TEXT    NOT NULL,
        old_quantity     INTEGER,
        new_quantity     INTEGER NOT NULL,
        vector_clock_json TEXT   NOT NULL,
        previous_mutation_id TEXT,
        occurred_at_ms   INTEGER NOT NULL
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE INDEX IF NOT EXISTS idx_mutation_history_item
        ON mutation_history (item_id, occurred_at_ms ASC)
      `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS or_set_tags (
        tag_id              TEXT    PRIMARY KEY,
        item_id             TEXT    NOT NULL,
        actor_device_id     TEXT    NOT NULL,
        added_at_ms         INTEGER NOT NULL,
        tombstoned_at_ms    INTEGER,
        tombstone_device_id TEXT
      ) WITHOUT ROWID
      `,
    ],
    [
      `
      CREATE INDEX IF NOT EXISTS idx_or_set_tags_item
        ON or_set_tags (item_id)
      `,
    ],
  ],
};
