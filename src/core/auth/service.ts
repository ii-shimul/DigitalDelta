import type {
  AppRole,
  AuthService,
  AuthVerificationResult,
  DeviceIdentityRecord,
  IssuedOfflineOtpRecord,
} from '../contracts';
import { tickVectorClock } from '../crdt';

import { buildAuthAuditEntry, verifyAuthAuditEntries } from './audit';
import { AUTH_AUDIT_EVENT_TYPES, AUTH_PAYLOAD_TYPE_PREFIX } from './constants';
import { bytesToHex, generateEd25519KeyPair, randomBytes } from './crypto';
import { defaultDeviceKeyVault, type DeviceKeyVault } from './key-vault';
import {
  createInMemoryLedgerService,
  createSQLiteLedgerService,
  type AuthLedgerService,
} from './ledger-service';
import {
  buildIssuedOtp,
  generateOtpSecretHex,
  validateIssuedOtpCode,
} from './otp';
import { hasRolePermission } from './permissions';
import {
  createInMemoryAuthStore,
  createSQLiteAuthStore,
  type AuthStore,
  type AuthUserRecord,
  type OtpSecretRecord,
  type StoredAuthSessionRecord,
} from './store';

export function createSQLiteAuthService(
  options: {
    keyVault?: DeviceKeyVault;
    now?: () => number;
  } = {},
): AuthService {
  return createAuthService({
    authStore: createSQLiteAuthStore(),
    ledgerService: createSQLiteLedgerService(),
    keyVault: options.keyVault,
    now: options.now,
  });
}

export function createInMemoryAuthContext(
  options: {
    users?: AuthUserRecord[];
    deviceIdentities?: DeviceIdentityRecord[];
    now?: () => number;
    keyVault?: DeviceKeyVault;
  } = {},
) {
  const authStore = createInMemoryAuthStore({
    users: options.users,
    deviceIdentities: options.deviceIdentities,
  });
  const ledgerService = createInMemoryLedgerService();
  const authService = createAuthService({
    authStore,
    ledgerService,
    keyVault: options.keyVault,
    now: options.now,
  });

  return {
    authService,
    authStore,
    ledgerService,
    keyVault: options.keyVault ?? defaultDeviceKeyVault,
  };
}

export function createAuthService(options: {
  authStore: AuthStore;
  ledgerService: AuthLedgerService;
  keyVault?: DeviceKeyVault;
  now?: () => number;
}): AuthService {
  const keyVault = options.keyVault ?? defaultDeviceKeyVault;
  const now = options.now ?? (() => Date.now());

  return {
    async provisionDeviceIdentity(input) {
      const user = await getActiveUser(input.userId);
      const existingIdentity = await options.authStore.getDeviceIdentity(
        input.deviceId,
      );
      const keyPair = generateEd25519KeyPair();
      const occurredAtMs = now();
      const roles = normalizeRoles(input.roles, user.primaryRole);
      const identity: DeviceIdentityRecord = {
        deviceId: input.deviceId,
        userId: input.userId,
        publicKeyPem: keyPair.publicKeyPem,
        keyAlgorithm: keyPair.algorithm,
        keyFingerprint: keyPair.keyFingerprint,
        roles,
        provisionedAtMs: existingIdentity?.provisionedAtMs ?? occurredAtMs,
        lastRotatedAtMs: existingIdentity ? occurredAtMs : undefined,
      };

      await keyVault.set(input.deviceId, {
        deviceId: input.deviceId,
        algorithm: keyPair.algorithm,
        keyFingerprint: keyPair.keyFingerprint,
        publicKeyPem: keyPair.publicKeyPem,
        privateKeyPem: keyPair.privateKeyPem,
        secretKeyHex: bytesToHex(keyPair.secretKey),
        seedHex: bytesToHex(keyPair.seed),
        storedAtMs: occurredAtMs,
      });
      await options.authStore.upsertDeviceIdentity(identity);

      await appendAuthEvent({
        actorDeviceId: input.deviceId,
        authEventType: existingIdentity
          ? AUTH_AUDIT_EVENT_TYPES.keyRotated
          : AUTH_AUDIT_EVENT_TYPES.keyProvisioned,
        entityId: input.deviceId,
        entityType: 'device',
        keyFingerprint: identity.keyFingerprint,
        occurredAtMs,
        user,
      });

      return identity;
    },
    async issueOfflineOtp(input): Promise<IssuedOfflineOtpRecord> {
      const user = await getActiveUser(input.userId);
      const existingSecret = await options.authStore.getOtpSecret(
        input.userId,
        input.deviceId,
      );
      const otpSecret =
        existingSecret ?? buildOtpSecret(input, input.issuedAtMs);

      if (!existingSecret) {
        await options.authStore.upsertOtpSecret(otpSecret);
      }

      const issuedOtp = buildIssuedOtp({
        secretHex: otpSecret.secretHex,
        issuedAtMs: input.issuedAtMs,
      });
      const session: StoredAuthSessionRecord = {
        otpSessionId: createIdentifier('otp'),
        userId: input.userId,
        deviceId: input.deviceId,
        otpSecretId: otpSecret.secretId,
        issuedCounter: issuedOtp.counter,
        algorithm: issuedOtp.algorithm,
        digits: issuedOtp.digits,
        periodSeconds: issuedOtp.periodSeconds,
        issuedAtMs: input.issuedAtMs,
        expiresAtMs: issuedOtp.expiresAtMs,
        failedAttemptCount: 0,
        status: 'issued',
        metadata: {},
      };

      await options.authStore.saveAuthSession(session);
      await appendAuthEvent({
        actorDeviceId: input.deviceId,
        authEventType: AUTH_AUDIT_EVENT_TYPES.otpIssued,
        entityId: session.otpSessionId,
        entityType: 'auth_session',
        occurredAtMs: input.issuedAtMs,
        otpSession: session,
        user,
      });

      return {
        ...session,
        code: issuedOtp.code,
      };
    },
    async verifyOfflineOtp(input): Promise<AuthVerificationResult> {
      const session = await options.authStore.getAuthSession(
        input.otpSessionId,
      );
      if (!session) {
        const authEventId = await appendAuthEvent({
          actorDeviceId: 'AUTH-ENGINE',
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: input.otpSessionId,
          entityType: 'auth_session',
          failureReason: 'session_not_found',
          occurredAtMs: input.verifiedAtMs,
        });

        return {
          verified: false,
          authEventId,
          failureReason: 'session_not_found',
        };
      }

      const user = await options.authStore.getUserById(session.userId);
      if (!user) {
        session.failedAttemptCount += 1;
        session.failureReason = 'user_not_found';
        await options.authStore.saveAuthSession(session);

        const authEventId = await appendAuthEvent({
          actorDeviceId: session.deviceId,
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: session.otpSessionId,
          entityType: 'auth_session',
          failureReason: 'user_not_found',
          occurredAtMs: input.verifiedAtMs,
          otpSession: session,
        });

        return {
          verified: false,
          authEventId,
          failureReason: 'user_not_found',
          session,
        };
      }

      if (user.status !== 'active') {
        session.failedAttemptCount += 1;
        session.failureReason = 'user_inactive';
        await options.authStore.saveAuthSession(session);

        const authEventId = await appendAuthEvent({
          actorDeviceId: session.deviceId,
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: session.otpSessionId,
          entityType: 'auth_session',
          failureReason: 'user_inactive',
          occurredAtMs: input.verifiedAtMs,
          otpSession: session,
          user,
        });

        return {
          verified: false,
          authEventId,
          failureReason: 'user_inactive',
          session,
        };
      }

      if (session.status === 'verified') {
        const authEventId = await appendAuthEvent({
          actorDeviceId: session.deviceId,
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: session.otpSessionId,
          entityType: 'auth_session',
          failureReason: 'session_already_verified',
          occurredAtMs: input.verifiedAtMs,
          otpSession: session,
          user,
        });

        return {
          verified: false,
          authEventId,
          failureReason: 'session_already_verified',
          session,
        };
      }

      const otpSecret = await options.authStore.getOtpSecret(
        session.userId,
        session.deviceId,
      );
      if (!otpSecret) {
        session.failedAttemptCount += 1;
        session.failureReason = 'otp_secret_missing';
        await options.authStore.saveAuthSession(session);

        const authEventId = await appendAuthEvent({
          actorDeviceId: session.deviceId,
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: session.otpSessionId,
          entityType: 'auth_session',
          failureReason: 'otp_secret_missing',
          occurredAtMs: input.verifiedAtMs,
          otpSession: session,
          user,
        });

        return {
          verified: false,
          authEventId,
          failureReason: 'otp_secret_missing',
          session,
        };
      }

      const verificationResult = validateIssuedOtpCode({
        secretHex: otpSecret.secretHex,
        counter: session.issuedCounter,
        code: input.code,
        verifiedAtMs: input.verifiedAtMs,
        expiresAtMs: session.expiresAtMs,
        digits: session.digits,
      });

      if (!verificationResult.matched) {
        session.failedAttemptCount += 1;
        session.failureReason = verificationResult.failureReason;
        if (verificationResult.failureReason === 'otp_expired') {
          session.status = 'expired';
        }
        await options.authStore.saveAuthSession(session);

        const authEventId = await appendAuthEvent({
          actorDeviceId: session.deviceId,
          authEventType: AUTH_AUDIT_EVENT_TYPES.loginFailure,
          entityId: session.otpSessionId,
          entityType: 'auth_session',
          failureReason: verificationResult.failureReason,
          occurredAtMs: input.verifiedAtMs,
          otpSession: session,
          user,
        });

        return {
          verified: false,
          authEventId,
          failureReason: verificationResult.failureReason,
          session,
        };
      }

      session.verifiedAtMs = input.verifiedAtMs;
      session.status = 'verified';
      session.failureReason = undefined;
      await options.authStore.saveAuthSession(session);
      await options.authStore.updateUserLastLogin(
        user.userId,
        input.verifiedAtMs,
      );

      const authEventId = await appendAuthEvent({
        actorDeviceId: session.deviceId,
        authEventType: AUTH_AUDIT_EVENT_TYPES.loginSuccess,
        entityId: session.otpSessionId,
        entityType: 'auth_session',
        occurredAtMs: input.verifiedAtMs,
        otpSession: session,
        user,
      });

      let deviceIdentity = await options.authStore.getDeviceIdentity(
        session.deviceId,
      );
      if (!deviceIdentity) {
        deviceIdentity = await this.provisionDeviceIdentity({
          userId: user.userId,
          deviceId: session.deviceId,
          displayName: user.displayName,
          roles: user.roles,
        });
      }

      return {
        verified: true,
        authEventId,
        session,
        deviceIdentity,
      };
    },
    async hasPermission(input) {
      return hasRolePermission(input.actor.role, input.resource, input.action);
    },
    async verifyAuditTrail(input = {}) {
      const entries = await options.authStore.listAuthAuditEntries(input);
      return verifyAuthAuditEntries(entries);
    },
  };

  async function getActiveUser(userId: string): Promise<AuthUserRecord> {
    const user = await options.authStore.getUserById(userId);
    if (!user) {
      throw new Error(`Cannot continue auth flow for missing user ${userId}.`);
    }

    if (user.status !== 'active') {
      throw new Error(`Cannot continue auth flow for inactive user ${userId}.`);
    }

    return user;
  }

  async function appendAuthEvent(input: {
    actorDeviceId: string;
    authEventType: keyof typeof AUTH_AUDIT_EVENT_TYPES extends never
      ? never
      : (typeof AUTH_AUDIT_EVENT_TYPES)[keyof typeof AUTH_AUDIT_EVENT_TYPES];
    entityId: string;
    entityType: 'auth_session' | 'device' | 'user';
    occurredAtMs: number;
    user?: AuthUserRecord;
    otpSession?: StoredAuthSessionRecord;
    failureReason?: AuthVerificationResult['failureReason'];
    keyFingerprint?: string;
  }): Promise<string> {
    const authEventId = createIdentifier('auth');
    const latestAuditEntry = await options.authStore.getLatestAuthAuditEntry();
    const auditEntry = buildAuthAuditEntry({
      logId: createIdentifier('audit'),
      authEventId,
      eventType: input.authEventType,
      userId: input.user?.userId,
      deviceId: input.actorDeviceId,
      otpSessionId: input.otpSession?.otpSessionId,
      otpIssuedAtMs: input.otpSession?.issuedAtMs,
      otpExpiresAtMs: input.otpSession?.expiresAtMs,
      keyFingerprint: input.keyFingerprint,
      failureReason: input.failureReason,
      occurredAtMs: input.occurredAtMs,
      previousHash: latestAuditEntry?.currentHash,
      metadata: {},
    });

    await options.authStore.appendAuthAuditEntry(auditEntry);

    const previousClock =
      await options.ledgerService.getLatestVectorClockForDevice(
        input.actorDeviceId,
      );

    await options.ledgerService.appendEvent({
      eventId: authEventId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: 'auth',
      actor: buildActor(input.user, input.actorDeviceId),
      occurredAtMs: input.occurredAtMs,
      vectorClock: tickVectorClock(previousClock, input.actorDeviceId),
      payloadType: `${AUTH_PAYLOAD_TYPE_PREFIX}.${input.authEventType}`,
      payloadBlob: auditEntry.eventBlob,
      metadata: {
        authEventType: input.authEventType,
        failureReason: input.failureReason,
        keyFingerprint: input.keyFingerprint,
      },
    });

    return authEventId;
  }
}

function buildOtpSecret(
  input: {
    userId: string;
    deviceId: string;
  },
  createdAtMs: number,
): OtpSecretRecord {
  return {
    secretId: createIdentifier('otpsec'),
    userId: input.userId,
    deviceId: input.deviceId,
    algorithm: 'TOTP-SHA256',
    secretHex: generateOtpSecretHex(),
    digits: 6,
    periodSeconds: 30,
    createdAtMs,
    updatedAtMs: createdAtMs,
    metadata: {},
  };
}

function buildActor(
  user: AuthUserRecord | undefined,
  deviceId: string,
): {
  userId: string;
  deviceId: string;
  role: AppRole;
  displayName?: string;
} {
  if (user) {
    return {
      userId: user.userId,
      deviceId,
      role: user.primaryRole,
      displayName: user.displayName,
    };
  }

  return {
    userId: 'AUTH-ENGINE',
    deviceId,
    role: 'SYNC_ADMIN',
    displayName: 'Auth Engine',
  };
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${bytesToHex(randomBytes(8))}`;
}

function normalizeRoles(roles: AppRole[], fallbackRole: AppRole): AppRole[] {
  if (roles.length > 0) {
    return Array.from(new Set(roles));
  }

  return [fallbackRole];
}
