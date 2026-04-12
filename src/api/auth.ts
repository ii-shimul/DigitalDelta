import type {
  AppRole,
  AuthVerificationResult,
  AuditChainVerificationResult,
  DeviceIdentityRecord,
  IssuedOfflineOtpRecord,
} from '../core/contracts';
import { createSQLiteAuthService } from '../core/auth/service';
import { createSQLiteAuthStore } from '../core/auth/store';
import { bytesToHex, encodeUtf8, randomBytes } from '../core/auth/crypto';
import { getDatabase } from '../db';
import type { AuthService } from '../core/contracts';
import type { AuthStore } from '../core/auth/store';

let cachedAuthService: AuthService | null = null;
let cachedAuthStore: AuthStore | null = null;

function getAuthService(): AuthService {
  if (!cachedAuthService) {
    cachedAuthService = createSQLiteAuthService();
  }
  return cachedAuthService;
}

function getAuthStore(): AuthStore {
  if (!cachedAuthStore) {
    cachedAuthStore = createSQLiteAuthStore();
  }
  return cachedAuthStore!;
}

export type RegisteredUser = {
  userId: string;
  deviceId: string;
  displayName: string;
  role: AppRole;
};

export async function registerUser(input: {
  displayName: string;
  role: AppRole;
}): Promise<RegisteredUser> {
  const db = await getDatabase();
  const nowMs = Date.now();
  const userId = `USR-${bytesToHex(randomBytes(4)).toUpperCase()}`;
  const deviceId = `DEV-${bytesToHex(randomBytes(4)).toUpperCase()}`;

  await db.execute(
    `INSERT INTO users (user_id, display_name, primary_role, roles_json, status, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [
      userId,
      input.displayName.trim(),
      input.role,
      JSON.stringify([input.role]),
      nowMs,
      nowMs,
    ],
  );

  const svc = getAuthService();
  await svc.provisionDeviceIdentity({
    userId,
    deviceId,
    displayName: input.displayName.trim(),
    roles: [input.role],
  });

  return {
    userId,
    deviceId,
    displayName: input.displayName.trim(),
    role: input.role,
  };
}

export async function getRegisteredUser(): Promise<RegisteredUser | null> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT u.user_id, u.display_name, u.primary_role, d.device_id
     FROM users u
     LEFT JOIN device_identity d ON d.user_id = u.user_id
     WHERE u.status = 'active'
     ORDER BY u.created_at_ms DESC
     LIMIT 1`,
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    userId: String(row.user_id),
    deviceId: row.device_id ? String(row.device_id) : '',
    displayName: String(row.display_name),
    role: String(row.primary_role) as AppRole,
  };
}

export async function requestOtp(
  userId: string,
  deviceId: string,
  role: AppRole,
): Promise<IssuedOfflineOtpRecord> {
  const svc = getAuthService();
  return svc.issueOfflineOtp({
    userId,
    deviceId,
    role,
    issuedAtMs: Date.now(),
  });
}

export async function verifyOtp(
  sessionId: string,
  code: string,
): Promise<AuthVerificationResult> {
  const svc = getAuthService();
  return svc.verifyOfflineOtp({
    otpSessionId: sessionId,
    code: code.trim(),
    verifiedAtMs: Date.now(),
  });
}

export async function getDeviceIdentity(
  deviceId: string,
): Promise<DeviceIdentityRecord | null> {
  const store = getAuthStore();
  return store.getDeviceIdentity(deviceId);
}

export async function verifyAuditTrail(): Promise<AuditChainVerificationResult> {
  const svc = getAuthService();
  return svc.verifyAuditTrail();
}

export async function getAuditLogCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.execute('SELECT COUNT(*) as cnt FROM auth_audit_log');
  return Number(result.rows[0]?.cnt ?? 0);
}

export async function injectAuditCorruption(): Promise<{
  corrupted: boolean;
  logId?: string;
}> {
  const store = getAuthStore();
  const entries = await store.listAuthAuditEntries();
  const latest = entries.at(-1);
  if (!latest) {
    return { corrupted: false };
  }

  await store.overwriteAuthAuditEventBlob(
    latest.logId,
    encodeUtf8(`tampered-event:${Date.now()}`),
  );

  return { corrupted: true, logId: latest.logId };
}
