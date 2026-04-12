import {
  buildAuthAuditEntry,
  createInMemoryAuthContext,
  verifyAuthAuditEntries,
} from '../src/core/auth';

const BASE_TIME_MS = Date.parse('2026-04-12T09:00:00Z');

const testUser = {
  userId: 'USR-TEST-001',
  displayName: 'Test Operator',
  primaryRole: 'SUPPLY_MANAGER' as const,
  roles: ['SUPPLY_MANAGER', 'SYNC_ADMIN'] as const,
  status: 'active',
  createdAtMs: BASE_TIME_MS - 60_000,
  updatedAtMs: BASE_TIME_MS - 60_000,
};

test('issues and verifies an offline OTP and provisions the device key', async () => {
  const { authService } = createInMemoryAuthContext({
    users: [
      {
        ...testUser,
        roles: [...testUser.roles],
      },
    ],
  });

  const issuedOtp = await authService.issueOfflineOtp({
    userId: testUser.userId,
    deviceId: 'DEV-TEST-01',
    issuedAtMs: BASE_TIME_MS,
  });

  expect(issuedOtp.code).toMatch(/^\d{6}$/);
  expect(issuedOtp.status).toBe('issued');

  const verification = await authService.verifyOfflineOtp({
    otpSessionId: issuedOtp.otpSessionId,
    code: issuedOtp.code,
    verifiedAtMs: BASE_TIME_MS + 1_000,
  });

  expect(verification.verified).toBe(true);
  expect(verification.session?.status).toBe('verified');
  expect(verification.deviceIdentity?.deviceId).toBe('DEV-TEST-01');
  expect(verification.deviceIdentity?.keyAlgorithm).toBe('ED25519');

  const auditVerification = await authService.verifyAuditTrail();
  expect(auditVerification.valid).toBe(true);
});

test('rejects an expired offline OTP', async () => {
  const { authService } = createInMemoryAuthContext({
    users: [
      {
        ...testUser,
        roles: [...testUser.roles],
      },
    ],
  });

  const issuedOtp = await authService.issueOfflineOtp({
    userId: testUser.userId,
    deviceId: 'DEV-TEST-02',
    issuedAtMs: BASE_TIME_MS,
  });

  const verification = await authService.verifyOfflineOtp({
    otpSessionId: issuedOtp.otpSessionId,
    code: issuedOtp.code,
    verifiedAtMs: issuedOtp.expiresAtMs + 1,
  });

  expect(verification.verified).toBe(false);
  expect(verification.failureReason).toBe('otp_expired');
  expect(verification.session?.status).toBe('expired');
});

test('denies unauthorized triage writes for a field volunteer', async () => {
  const { authService } = createInMemoryAuthContext();

  const allowed = await authService.hasPermission({
    actor: {
      userId: 'USR-VOL-001',
      deviceId: 'DEV-VOL-001',
      role: 'FIELD_VOLUNTEER',
    },
    resource: 'triage_decision',
    action: 'write',
  });

  expect(allowed).toBe(false);
});

test('detects audit log tampering', () => {
  const firstEntry = buildAuthAuditEntry({
    logId: 'LOG-001',
    authEventId: 'AUTH-001',
    eventType: 'otp_issued',
    userId: testUser.userId,
    deviceId: 'DEV-TEST-03',
    occurredAtMs: BASE_TIME_MS,
  });
  const secondEntry = buildAuthAuditEntry({
    logId: 'LOG-002',
    authEventId: 'AUTH-002',
    eventType: 'login_success',
    userId: testUser.userId,
    deviceId: 'DEV-TEST-03',
    occurredAtMs: BASE_TIME_MS + 1_000,
    previousHash: firstEntry.currentHash,
  });
  const tamperedEntry = {
    ...secondEntry,
    eventBlob: Uint8Array.from('tampered-auth-payload', character =>
      character.charCodeAt(0),
    ),
  };

  const verification = verifyAuthAuditEntries([firstEntry, tamperedEntry]);

  expect(verification.valid).toBe(false);
  expect(verification.brokenLogId).toBe('LOG-002');
});
