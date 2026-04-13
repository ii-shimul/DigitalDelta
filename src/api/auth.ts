import type {
  AppRole,
  AuthVerificationResult,
  AuditChainVerificationResult,
  DeviceIdentityRecord,
  IssuedOfflineOtpRecord,
} from '../core/contracts';
import { createSQLiteAuthService } from '../core/auth/service';
import { createSQLiteAuthStore } from '../core/auth/store';
import {
  bytesToHex,
  computeSha256Hex,
  encodeUtf8,
  hexToBytes,
  randomBytes,
} from '../core/auth/crypto';
import { createSecureDeviceKeyVault } from '../core/auth/key-vault';
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

export type AppSession = RegisteredUser & {
  sessionId: string;
};

// ── Registration ──

export async function registerUser(input: {
  displayName: string;
  role: AppRole;
  securityQuestion: string;
  securityAnswer: string;
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

  const answerHash = hashSecurityAnswer(input.securityAnswer);
  await db.execute(
    `INSERT INTO security_questions (user_id, question, answer_hash, created_at_ms)
     VALUES (?, ?, ?, ?)`,
    [userId, input.securityQuestion.trim(), answerHash, nowMs],
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

// ── User lookup ──

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

// ── Security question ──

export async function getSecurityQuestion(
  userId: string,
): Promise<string | null> {
  const db = await getDatabase();
  const result = await db.execute(
    'SELECT question FROM security_questions WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const row = result.rows[0];
  return row ? String(row.question) : null;
}

export async function verifySecurityAnswer(
  userId: string,
  answer: string,
): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.execute(
    'SELECT answer_hash FROM security_questions WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return false;
  }
  return String(row.answer_hash) === hashSecurityAnswer(answer);
}

function hashSecurityAnswer(answer: string): string {
  return computeSha256Hex([answer.trim().toLowerCase()]);
}

// ── OTP ──

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

// ── Persistent app session ──

export async function createAppSession(
  user: RegisteredUser,
): Promise<AppSession> {
  const db = await getDatabase();
  const sessionId = `SES-${bytesToHex(randomBytes(6)).toUpperCase()}`;
  const nowMs = Date.now();

  // Deactivate old sessions
  await db.execute('UPDATE app_sessions SET is_active = 0 WHERE user_id = ?', [
    user.userId,
  ]);

  await db.execute(
    `INSERT INTO app_sessions (session_id, user_id, device_id, display_name, role, created_at_ms, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [sessionId, user.userId, user.deviceId, user.displayName, user.role, nowMs],
  );

  return { ...user, sessionId };
}

export async function getActiveSession(): Promise<AppSession | null> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT session_id, user_id, device_id, display_name, role
     FROM app_sessions
     WHERE is_active = 1
     ORDER BY created_at_ms DESC
     LIMIT 1`,
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    displayName: String(row.display_name),
    role: String(row.role) as AppRole,
  };
}

export async function clearActiveSession(): Promise<void> {
  const db = await getDatabase();
  await db.execute('UPDATE app_sessions SET is_active = 0 WHERE is_active = 1');
}

// ── Device identity & audit ──

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

export async function getAllUsers(): Promise<
  { userId: string; displayName: string; primaryRole: string }[]
> {
  const db = await getDatabase();
  const r = await db.execute(
    "SELECT user_id, display_name, primary_role FROM users WHERE status = 'active' ORDER BY display_name ASC",
  );
  return r.rows.map(row => ({
    userId: row.user_id as string,
    displayName: row.display_name as string,
    primaryRole: row.primary_role as string,
  }));
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

// ── Mesh key material ──
// Returns the Ed25519 seed for the local device so the mesh module can
// derive an X25519 keypair for nacl.box encryption/decryption.
// The seed never leaves this module boundary — it is not surfaced in any UI.
export async function getLocalDeviceSeed(
  deviceId: string,
): Promise<Uint8Array | null> {
  const vault = createSecureDeviceKeyVault();
  const material = await vault.get(deviceId);
  if (!material?.seedHex) {
    return null;
  }
  return hexToBytes(material.seedHex);
}
