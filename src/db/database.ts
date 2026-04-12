import { open, type DB } from '@op-engineering/op-sqlite';

import { migrations } from './migrations';
import type { DatabaseHandle, Migration } from './types';

const DATABASE_NAME = 'digital_delta.sqlite';
const DATABASE_LOCATION = 'default';

let database: DB | null = null;

const startupStatements = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = OFF',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA temp_store = MEMORY',
];

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at_ms INTEGER NOT NULL
  )
`;

export async function getDatabase(): Promise<DatabaseHandle> {
  if (database) {
    return database;
  }

  const db = open({
    name: DATABASE_NAME,
    location: DATABASE_LOCATION,
  });

  for (const statement of startupStatements) {
    db.executeSync(statement);
  }

  await db.execute(migrationTableSql);
  await applyMigrations(db, migrations);

  database = db;
  return db;
}

export function getDatabaseSync(): DatabaseHandle | null {
  return database;
}

export function closeDatabase(): void {
  if (!database) {
    return;
  }

  database.close();
  database = null;
}

async function applyMigrations(
  db: DatabaseHandle,
  pendingMigrations: Migration[],
) {
  const result = await db.execute(
    'SELECT id FROM schema_migrations ORDER BY id ASC',
  );
  const appliedMigrationIds = new Set(
    result.rows
      .map(row => Number(row.id))
      .filter(value => Number.isFinite(value)),
  );

  for (const migration of pendingMigrations) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    await db.executeBatch(migration.statements);
    await db.execute(
      'INSERT INTO schema_migrations (id, name, applied_at_ms) VALUES (?, ?, ?)',
      [migration.id, migration.name, Date.now()],
    );
  }
}
