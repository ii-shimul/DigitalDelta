import type { Migration } from '../types';

export const securityAndSessionMigration: Migration = {
  id: 3,
  name: 'security_question_and_app_session',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS security_questions (
        user_id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        answer_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS app_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      ) WITHOUT ROWID
    `,
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_app_sessions_active ON app_sessions(is_active, created_at_ms DESC)',
    ],
  ],
};
