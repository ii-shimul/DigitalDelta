import type { Migration } from '../types';

export const authStateMigration: Migration = {
  id: 2,
  name: 'auth_state',
  statements: [
    [
      `
      CREATE TABLE IF NOT EXISTS auth_otp_secrets (
        secret_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        secret_hex TEXT NOT NULL,
        digits INTEGER NOT NULL DEFAULT 6,
        period_seconds INTEGER NOT NULL DEFAULT 30,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      `
      CREATE TABLE IF NOT EXISTS auth_sessions (
        otp_session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        otp_secret_id TEXT NOT NULL,
        issued_counter INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        digits INTEGER NOT NULL DEFAULT 6,
        period_seconds INTEGER NOT NULL DEFAULT 30,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        verified_at_ms INTEGER,
        failed_attempt_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'issued',
        last_failure_reason TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      ) WITHOUT ROWID
    `,
    ],
    [
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_otp_secrets_user_device ON auth_otp_secrets(user_id, device_id)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_device ON auth_sessions(user_id, device_id, issued_at_ms DESC)',
    ],
    [
      'CREATE INDEX IF NOT EXISTS idx_auth_sessions_status_expires ON auth_sessions(status, expires_at_ms DESC)',
    ],
  ],
};
