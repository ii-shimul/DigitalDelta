import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type {
  AppRole,
  AuthFailureReason,
  AuthSessionRecord,
  DeviceIdentityRecord,
  OfflineOtpAlgorithm,
} from '../contracts';
import { isAppRole } from '../event-types';
import type { DatabaseHandle } from '../../db';

import type { AuthAuditLogEntry } from './audit';

declare const require: undefined | ((moduleName: string) => unknown);

type Scalar = SQLiteScalar | undefined;

export type AuthUserRecord = {
  userId: string;
  displayName: string;
  primaryRole: AppRole;
  roles: AppRole[];
  status: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastLoginAtMs?: number;
};

export type OtpSecretRecord = {
  secretId: string;
  userId: string;
  deviceId: string;
  algorithm: OfflineOtpAlgorithm;
  secretHex: string;
  digits: number;
  periodSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
  metadata: Record<string, unknown>;
};

export type StoredAuthSessionRecord = AuthSessionRecord & {
  otpSecretId: string;
  issuedCounter: number;
  metadata: Record<string, unknown>;
};

export interface AuthStore {
  getUserById(userId: string): Promise<AuthUserRecord | null>;
  updateUserLastLogin(userId: string, lastLoginAtMs: number): Promise<void>;
  getDeviceIdentity(deviceId: string): Promise<DeviceIdentityRecord | null>;
  upsertDeviceIdentity(record: DeviceIdentityRecord): Promise<void>;
  getOtpSecret(
    userId: string,
    deviceId: string,
  ): Promise<OtpSecretRecord | null>;
  upsertOtpSecret(record: OtpSecretRecord): Promise<void>;
  getAuthSession(otpSessionId: string): Promise<StoredAuthSessionRecord | null>;
  saveAuthSession(record: StoredAuthSessionRecord): Promise<void>;
  getLatestAuthAuditEntry(): Promise<AuthAuditLogEntry | null>;
  appendAuthAuditEntry(record: AuthAuditLogEntry): Promise<void>;
  overwriteAuthAuditEventBlob(
    logId: string,
    eventBlob: Uint8Array,
  ): Promise<void>;
  listAuthAuditEntries(filter?: {
    userId?: string;
    deviceId?: string;
  }): Promise<AuthAuditLogEntry[]>;
}

export function createSQLiteAuthStore(
  dbProvider: (() => Promise<DatabaseHandle>) | undefined = undefined,
): AuthStore {
  const resolvedDbProvider = dbProvider ?? getDefaultDatabaseProvider();

  return {
    async getUserById(userId) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            user_id AS userId,
            display_name AS displayName,
            primary_role AS primaryRole,
            roles_json AS rolesJson,
            status,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs,
            last_login_at_ms AS lastLoginAtMs
          FROM users
          WHERE user_id = ?
          LIMIT 1
        `,
        [userId],
      );

      const row = result.rows[0];
      return row ? mapUserRow(row) : null;
    },
    async updateUserLastLogin(userId, lastLoginAtMs) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          UPDATE users
          SET last_login_at_ms = ?, updated_at_ms = ?
          WHERE user_id = ?
        `,
        [lastLoginAtMs, lastLoginAtMs, userId],
      );
    },
    async getDeviceIdentity(deviceId) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            device_id AS deviceId,
            user_id AS userId,
            public_key_pem AS publicKeyPem,
            key_algorithm AS keyAlgorithm,
            key_fingerprint AS keyFingerprint,
            roles_json AS rolesJson,
            provisioned_at_ms AS provisionedAtMs,
            last_rotated_at_ms AS lastRotatedAtMs
          FROM device_identity
          WHERE device_id = ?
          LIMIT 1
        `,
        [deviceId],
      );

      const row = result.rows[0];
      return row ? mapDeviceIdentityRow(row) : null;
    },
    async upsertDeviceIdentity(record) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          INSERT OR REPLACE INTO device_identity (
            device_id,
            user_id,
            public_key_pem,
            key_algorithm,
            key_fingerprint,
            roles_json,
            provisioned_at_ms,
            last_rotated_at_ms,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.deviceId,
          record.userId,
          record.publicKeyPem,
          record.keyAlgorithm,
          record.keyFingerprint,
          JSON.stringify(record.roles),
          record.provisionedAtMs,
          record.lastRotatedAtMs ?? null,
          JSON.stringify({}),
        ],
      );
    },
    async getOtpSecret(userId, deviceId) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            secret_id AS secretId,
            user_id AS userId,
            device_id AS deviceId,
            algorithm,
            secret_hex AS secretHex,
            digits,
            period_seconds AS periodSeconds,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs,
            metadata_json AS metadataJson
          FROM auth_otp_secrets
          WHERE user_id = ? AND device_id = ?
          LIMIT 1
        `,
        [userId, deviceId],
      );

      const row = result.rows[0];
      return row ? mapOtpSecretRow(row) : null;
    },
    async upsertOtpSecret(record) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          INSERT OR REPLACE INTO auth_otp_secrets (
            secret_id,
            user_id,
            device_id,
            algorithm,
            secret_hex,
            digits,
            period_seconds,
            created_at_ms,
            updated_at_ms,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.secretId,
          record.userId,
          record.deviceId,
          record.algorithm,
          record.secretHex,
          record.digits,
          record.periodSeconds,
          record.createdAtMs,
          record.updatedAtMs,
          JSON.stringify(record.metadata),
        ],
      );
    },
    async getAuthSession(otpSessionId) {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            otp_session_id AS otpSessionId,
            user_id AS userId,
            device_id AS deviceId,
            otp_secret_id AS otpSecretId,
            issued_counter AS issuedCounter,
            algorithm,
            digits,
            period_seconds AS periodSeconds,
            issued_at_ms AS issuedAtMs,
            expires_at_ms AS expiresAtMs,
            verified_at_ms AS verifiedAtMs,
            failed_attempt_count AS failedAttemptCount,
            status,
            last_failure_reason AS failureReason,
            metadata_json AS metadataJson
          FROM auth_sessions
          WHERE otp_session_id = ?
          LIMIT 1
        `,
        [otpSessionId],
      );

      const row = result.rows[0];
      return row ? mapAuthSessionRow(row) : null;
    },
    async saveAuthSession(record) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          INSERT OR REPLACE INTO auth_sessions (
            otp_session_id,
            user_id,
            device_id,
            otp_secret_id,
            issued_counter,
            algorithm,
            digits,
            period_seconds,
            issued_at_ms,
            expires_at_ms,
            verified_at_ms,
            failed_attempt_count,
            status,
            last_failure_reason,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.otpSessionId,
          record.userId,
          record.deviceId,
          record.otpSecretId,
          record.issuedCounter,
          record.algorithm,
          record.digits,
          record.periodSeconds,
          record.issuedAtMs,
          record.expiresAtMs,
          record.verifiedAtMs ?? null,
          record.failedAttemptCount,
          record.status,
          record.failureReason ?? null,
          JSON.stringify(record.metadata),
        ],
      );
    },
    async getLatestAuthAuditEntry() {
      const db = await resolvedDbProvider();
      const result = await db.execute(
        `
          SELECT
            log_id AS logId,
            auth_event_id AS authEventId,
            event_type AS eventType,
            user_id AS userId,
            device_id AS deviceId,
            otp_session_id AS otpSessionId,
            otp_issued_at_ms AS otpIssuedAtMs,
            otp_expires_at_ms AS otpExpiresAtMs,
            key_fingerprint AS keyFingerprint,
            failure_reason AS failureReason,
            previous_hash AS previousHash,
            payload_hash AS payloadHash,
            current_hash AS currentHash,
            occurred_at_ms AS occurredAtMs,
            event_blob AS eventBlob,
            metadata_json AS metadataJson
          FROM auth_audit_log
          ORDER BY occurred_at_ms DESC, log_id DESC
          LIMIT 1
        `,
      );

      const row = result.rows[0];
      return row ? mapAuthAuditRow(row) : null;
    },
    async appendAuthAuditEntry(record) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          INSERT INTO auth_audit_log (
            log_id,
            auth_event_id,
            event_type,
            user_id,
            device_id,
            otp_session_id,
            otp_issued_at_ms,
            otp_expires_at_ms,
            key_fingerprint,
            failure_reason,
            previous_hash,
            payload_hash,
            current_hash,
            occurred_at_ms,
            event_blob,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.logId,
          record.authEventId,
          record.eventType,
          record.userId ?? null,
          record.deviceId ?? null,
          record.otpSessionId ?? null,
          record.otpIssuedAtMs ?? null,
          record.otpExpiresAtMs ?? null,
          record.keyFingerprint ?? null,
          record.failureReason ?? null,
          record.previousHash ?? null,
          record.payloadHash,
          record.currentHash,
          record.occurredAtMs,
          record.eventBlob,
          JSON.stringify(record.metadata),
        ],
      );
    },
    async overwriteAuthAuditEventBlob(logId, eventBlob) {
      const db = await resolvedDbProvider();
      await db.execute(
        `
          UPDATE auth_audit_log
          SET event_blob = ?
          WHERE log_id = ?
        `,
        [eventBlob, logId],
      );
    },
    async listAuthAuditEntries(filter = {}) {
      const db = await resolvedDbProvider();
      const filters: string[] = [];
      const params: Array<string> = [];

      if (filter.userId) {
        filters.push('user_id = ?');
        params.push(filter.userId);
      }

      if (filter.deviceId) {
        filters.push('device_id = ?');
        params.push(filter.deviceId);
      }

      const whereClause =
        filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const result = await db.execute(
        `
          SELECT
            log_id AS logId,
            auth_event_id AS authEventId,
            event_type AS eventType,
            user_id AS userId,
            device_id AS deviceId,
            otp_session_id AS otpSessionId,
            otp_issued_at_ms AS otpIssuedAtMs,
            otp_expires_at_ms AS otpExpiresAtMs,
            key_fingerprint AS keyFingerprint,
            failure_reason AS failureReason,
            previous_hash AS previousHash,
            payload_hash AS payloadHash,
            current_hash AS currentHash,
            occurred_at_ms AS occurredAtMs,
            event_blob AS eventBlob,
            metadata_json AS metadataJson
          FROM auth_audit_log
          ${whereClause}
          ORDER BY occurred_at_ms ASC, log_id ASC
        `,
        params,
      );

      return result.rows.map(mapAuthAuditRow);
    },
  };
}

function getDefaultDatabaseProvider(): () => Promise<DatabaseHandle> {
  if (typeof require !== 'function') {
    throw new Error('SQLite auth store requires a runtime module loader.');
  }

  const dbModule = require('../../db') as {
    getDatabase: () => Promise<DatabaseHandle>;
  };

  return dbModule.getDatabase;
}

export function createInMemoryAuthStore(seed?: {
  users?: AuthUserRecord[];
  deviceIdentities?: DeviceIdentityRecord[];
  otpSecrets?: OtpSecretRecord[];
  authSessions?: StoredAuthSessionRecord[];
  authAuditEntries?: AuthAuditLogEntry[];
}): AuthStore {
  const users = new Map(
    (seed?.users ?? []).map(user => [user.userId, cloneUserRecord(user)]),
  );
  const deviceIdentities = new Map(
    (seed?.deviceIdentities ?? []).map(record => [
      record.deviceId,
      cloneDeviceIdentityRecord(record),
    ]),
  );
  const otpSecrets = new Map(
    (seed?.otpSecrets ?? []).map(record => [
      `${record.userId}:${record.deviceId}`,
      cloneOtpSecretRecord(record),
    ]),
  );
  const authSessions = new Map(
    (seed?.authSessions ?? []).map(record => [
      record.otpSessionId,
      cloneAuthSessionRecord(record),
    ]),
  );
  const authAuditEntries = (seed?.authAuditEntries ?? []).map(entry =>
    cloneAuthAuditLogEntry(entry),
  );

  return {
    async getUserById(userId) {
      const user = users.get(userId);
      return user ? cloneUserRecord(user) : null;
    },
    async updateUserLastLogin(userId, lastLoginAtMs) {
      const user = users.get(userId);
      if (!user) {
        return;
      }

      users.set(userId, {
        ...user,
        lastLoginAtMs,
        updatedAtMs: lastLoginAtMs,
      });
    },
    async getDeviceIdentity(deviceId) {
      const record = deviceIdentities.get(deviceId);
      return record ? cloneDeviceIdentityRecord(record) : null;
    },
    async upsertDeviceIdentity(record) {
      deviceIdentities.set(record.deviceId, cloneDeviceIdentityRecord(record));
    },
    async getOtpSecret(userId, deviceId) {
      const record = otpSecrets.get(`${userId}:${deviceId}`);
      return record ? cloneOtpSecretRecord(record) : null;
    },
    async upsertOtpSecret(record) {
      otpSecrets.set(
        `${record.userId}:${record.deviceId}`,
        cloneOtpSecretRecord(record),
      );
    },
    async getAuthSession(otpSessionId) {
      const record = authSessions.get(otpSessionId);
      return record ? cloneAuthSessionRecord(record) : null;
    },
    async saveAuthSession(record) {
      authSessions.set(record.otpSessionId, cloneAuthSessionRecord(record));
    },
    async getLatestAuthAuditEntry() {
      const latestEntry = [...authAuditEntries].sort((left, right) => {
        if (left.occurredAtMs === right.occurredAtMs) {
          return right.logId.localeCompare(left.logId);
        }

        return right.occurredAtMs - left.occurredAtMs;
      })[0];

      return latestEntry ? cloneAuthAuditLogEntry(latestEntry) : null;
    },
    async appendAuthAuditEntry(record) {
      authAuditEntries.push(cloneAuthAuditLogEntry(record));
    },
    async overwriteAuthAuditEventBlob(logId, eventBlob) {
      const entryIndex = authAuditEntries.findIndex(
        entry => entry.logId === logId,
      );
      if (entryIndex < 0) {
        return;
      }

      authAuditEntries[entryIndex] = {
        ...authAuditEntries[entryIndex],
        eventBlob: new Uint8Array(eventBlob),
      };
    },
    async listAuthAuditEntries(filter = {}) {
      return authAuditEntries
        .filter(entry => {
          if (filter.userId && entry.userId !== filter.userId) {
            return false;
          }

          if (filter.deviceId && entry.deviceId !== filter.deviceId) {
            return false;
          }

          return true;
        })
        .sort((left, right) => {
          if (left.occurredAtMs === right.occurredAtMs) {
            return left.logId.localeCompare(right.logId);
          }

          return left.occurredAtMs - right.occurredAtMs;
        })
        .map(entry => cloneAuthAuditLogEntry(entry));
    },
  };
}

function mapUserRow(row: Record<string, Scalar>): AuthUserRecord {
  return {
    userId: asString(row.userId),
    displayName: asString(row.displayName),
    primaryRole: asAppRole(row.primaryRole),
    roles: parseAppRoles(row.rolesJson),
    status: asString(row.status),
    createdAtMs: asNumber(row.createdAtMs),
    updatedAtMs: asNumber(row.updatedAtMs),
    lastLoginAtMs: asOptionalNumber(row.lastLoginAtMs),
  };
}

function mapDeviceIdentityRow(
  row: Record<string, Scalar>,
): DeviceIdentityRecord {
  return {
    deviceId: asString(row.deviceId),
    userId: asString(row.userId),
    publicKeyPem: asString(row.publicKeyPem),
    keyAlgorithm: asString(
      row.keyAlgorithm,
    ) as DeviceIdentityRecord['keyAlgorithm'],
    keyFingerprint: asString(row.keyFingerprint),
    roles: parseAppRoles(row.rolesJson),
    provisionedAtMs: asNumber(row.provisionedAtMs),
    lastRotatedAtMs: asOptionalNumber(row.lastRotatedAtMs),
  };
}

function mapOtpSecretRow(row: Record<string, Scalar>): OtpSecretRecord {
  return {
    secretId: asString(row.secretId),
    userId: asString(row.userId),
    deviceId: asString(row.deviceId),
    algorithm: asString(row.algorithm) as OfflineOtpAlgorithm,
    secretHex: asString(row.secretHex),
    digits: asNumber(row.digits),
    periodSeconds: asNumber(row.periodSeconds),
    createdAtMs: asNumber(row.createdAtMs),
    updatedAtMs: asNumber(row.updatedAtMs),
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function mapAuthSessionRow(
  row: Record<string, Scalar>,
): StoredAuthSessionRecord {
  const metadata = parseJsonRecord(row.metadataJson);

  return {
    otpSessionId: asString(row.otpSessionId),
    userId: asString(row.userId),
    deviceId: asString(row.deviceId),
    requestedRole: parseRequestedRole(metadata),
    otpSecretId: asString(row.otpSecretId),
    issuedCounter: asNumber(row.issuedCounter),
    algorithm: asString(row.algorithm) as OfflineOtpAlgorithm,
    digits: asNumber(row.digits),
    periodSeconds: asNumber(row.periodSeconds),
    issuedAtMs: asNumber(row.issuedAtMs),
    expiresAtMs: asNumber(row.expiresAtMs),
    verifiedAtMs: asOptionalNumber(row.verifiedAtMs),
    failedAttemptCount: asNumber(row.failedAttemptCount),
    status: asString(row.status) as AuthSessionRecord['status'],
    failureReason: asOptionalString(row.failureReason) as
      | AuthFailureReason
      | undefined,
    metadata,
  };
}

function mapAuthAuditRow(row: Record<string, Scalar>): AuthAuditLogEntry {
  return {
    logId: asString(row.logId),
    authEventId: asString(row.authEventId),
    eventType: asString(row.eventType) as AuthAuditLogEntry['eventType'],
    userId: asOptionalString(row.userId),
    deviceId: asOptionalString(row.deviceId),
    otpSessionId: asOptionalString(row.otpSessionId),
    otpIssuedAtMs: asOptionalNumber(row.otpIssuedAtMs),
    otpExpiresAtMs: asOptionalNumber(row.otpExpiresAtMs),
    keyFingerprint: asOptionalString(row.keyFingerprint),
    failureReason: asOptionalString(row.failureReason) as
      | AuthFailureReason
      | undefined,
    previousHash: asBlob(row.previousHash),
    payloadHash: asBlob(row.payloadHash) ?? new Uint8Array(),
    currentHash: asBlob(row.currentHash) ?? new Uint8Array(),
    occurredAtMs: asNumber(row.occurredAtMs),
    eventBlob: asBlob(row.eventBlob) ?? new Uint8Array(),
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function parseAppRoles(value: Scalar): AppRole[] {
  const parsed = parseJsonArray(value);
  return parsed.filter(
    (item): item is AppRole => typeof item === 'string' && isAppRole(item),
  );
}

function parseJsonArray(value: Scalar): unknown[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: Scalar): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseRequestedRole(metadata: Record<string, unknown>): AppRole {
  const requestedRole = metadata.requestedRole;
  return typeof requestedRole === 'string' && isAppRole(requestedRole)
    ? requestedRole
    : 'FIELD_VOLUNTEER';
}

function asAppRole(value: Scalar): AppRole {
  const role = asString(value);
  return isAppRole(role) ? role : 'FIELD_VOLUNTEER';
}

function asString(value: Scalar): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asOptionalNumber(value: Scalar): number | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }

  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBlob(value: Scalar): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}

function cloneUserRecord(record: AuthUserRecord): AuthUserRecord {
  return {
    ...record,
    roles: [...record.roles],
  };
}

function cloneDeviceIdentityRecord(
  record: DeviceIdentityRecord,
): DeviceIdentityRecord {
  return {
    ...record,
    roles: [...record.roles],
  };
}

function cloneOtpSecretRecord(record: OtpSecretRecord): OtpSecretRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function cloneAuthSessionRecord(
  record: StoredAuthSessionRecord,
): StoredAuthSessionRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function cloneAuthAuditLogEntry(entry: AuthAuditLogEntry): AuthAuditLogEntry {
  return {
    ...entry,
    previousHash: entry.previousHash
      ? new Uint8Array(entry.previousHash)
      : undefined,
    payloadHash: new Uint8Array(entry.payloadHash),
    currentHash: new Uint8Array(entry.currentHash),
    eventBlob: new Uint8Array(entry.eventBlob),
    metadata: { ...entry.metadata },
  };
}
