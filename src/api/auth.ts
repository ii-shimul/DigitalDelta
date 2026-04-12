import type {
  AppRole,
  AuthFailureReason,
  AuthSessionRecord,
  DeviceIdentityRecord,
} from '../core';
import {
  APP_ROLES,
  createSQLiteAuthService,
  createSQLiteAuthStore,
  encodeUtf8,
} from '../core';

import type { LoginScreenData } from './screen-contracts';

export const AUTH_ROLES = APP_ROLES;

export type AuthRole = AppRole;

export type AuthOtpChallenge = {
  otpSessionId: string;
  userId: string;
  deviceId: string;
  requestedRole: AuthRole;
  issuedAtMs: number;
  expiresAtMs: number;
  demoCode: string;
};

export type AuthenticatedSession = {
  authEventId: string;
  userId: string;
  deviceId: string;
  displayName: string;
  activeRole: AuthRole;
  roles: AuthRole[];
  authenticatedAtMs: number;
  keyFingerprint?: string;
  keyAlgorithm?: string;
};

export type AuthAuditStatus = {
  valid: boolean;
  scannedEntries: number;
  brokenLogId?: string;
  checkedAtMs: number;
};

export type AuthFailureCode =
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'ACCESS_DENIED'
  | 'AUTH_SYSTEM_ERROR';

export type AuthFailureState = {
  code: AuthFailureCode;
  title: string;
  message: string;
  reason?: AuthFailureReason;
};

const authService = createSQLiteAuthService();
const authStore = createSQLiteAuthStore();

export class AuthApi {
  async requestOtp(input: {
    loginData: LoginScreenData;
    selectedRole: AuthRole;
  }): Promise<AuthOtpChallenge> {
    const deviceId = requireDeviceId(input.loginData);

    const issuedOtp = await authService.issueOfflineOtp({
      userId: input.loginData.userId,
      deviceId,
      role: input.selectedRole,
      issuedAtMs: Date.now(),
    });

    return {
      otpSessionId: issuedOtp.otpSessionId,
      userId: issuedOtp.userId,
      deviceId: issuedOtp.deviceId,
      requestedRole: issuedOtp.requestedRole,
      issuedAtMs: issuedOtp.issuedAtMs,
      expiresAtMs: issuedOtp.expiresAtMs,
      demoCode: issuedOtp.code,
    };
  }

  async verifyOtp(input: {
    loginData: LoginScreenData;
    otpSession: AuthOtpChallenge;
    otpCode: string;
  }): Promise<
    | {
        ok: true;
        session: AuthenticatedSession;
      }
    | {
        ok: false;
        error: AuthFailureState;
      }
  > {
    const verification = await authService.verifyOfflineOtp({
      otpSessionId: input.otpSession.otpSessionId,
      code: input.otpCode.trim(),
      verifiedAtMs: Date.now(),
    });

    if (!verification.verified || !verification.session) {
      return {
        ok: false,
        error: mapAuthFailure(verification.failureReason),
      };
    }

    const activeRole = verification.session.requestedRole;
    const roles = getAvailableAuthRoles(input.loginData);

    return {
      ok: true,
      session: {
        authEventId: verification.authEventId,
        userId: input.loginData.userId,
        deviceId: requireDeviceId(input.loginData),
        displayName: input.loginData.displayName,
        activeRole,
        roles,
        authenticatedAtMs: verification.session.verifiedAtMs ?? Date.now(),
        keyFingerprint:
          verification.deviceIdentity?.keyFingerprint ??
          input.loginData.keyFingerprint,
        keyAlgorithm:
          verification.deviceIdentity?.keyAlgorithm ??
          input.loginData.keyAlgorithm,
      },
    };
  }

  async rotateDeviceKey(input: {
    loginData: LoginScreenData;
  }): Promise<DeviceIdentityRecord> {
    const roles = getAvailableAuthRoles(input.loginData);

    return authService.provisionDeviceIdentity({
      userId: input.loginData.userId,
      deviceId: requireDeviceId(input.loginData),
      displayName: input.loginData.displayName,
      roles,
    });
  }

  async verifyAuditTrail(input: {
    loginData: LoginScreenData;
  }): Promise<AuthAuditStatus> {
    const result = await authService.verifyAuditTrail({
      userId: input.loginData.userId,
      deviceId: requireDeviceId(input.loginData),
    });

    return {
      ...result,
      checkedAtMs: Date.now(),
    };
  }

  async injectAuditCorruptionForDemo(input: {
    loginData: LoginScreenData;
  }): Promise<{ corrupted: boolean; logId?: string }> {
    const entries = await authStore.listAuthAuditEntries({
      userId: input.loginData.userId,
      deviceId: requireDeviceId(input.loginData),
    });
    const latestEntry = entries.at(-1);

    if (!latestEntry) {
      return { corrupted: false };
    }

    await authStore.overwriteAuthAuditEventBlob(
      latestEntry.logId,
      encodeUtf8(`tampered-auth-event:${Date.now()}`),
    );

    return {
      corrupted: true,
      logId: latestEntry.logId,
    };
  }
}

export function getAvailableAuthRoles(loginData: LoginScreenData): AuthRole[] {
  const roles = loginData.roles
    .map(normalizeAuthRole)
    .filter((role): role is AuthRole => Boolean(role));

  if (roles.length > 0) {
    return Array.from(new Set(roles));
  }

  const primaryRole = normalizeAuthRole(loginData.primaryRole);
  return primaryRole ? [primaryRole] : ['FIELD_VOLUNTEER'];
}

export function normalizeAuthRole(value: string): AuthRole | null {
  const normalizedValue = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  return AUTH_ROLES.find(role => role === normalizedValue) ?? null;
}

function requireDeviceId(loginData: LoginScreenData): string {
  if (loginData.deviceId && loginData.deviceId.length > 0) {
    return loginData.deviceId;
  }

  throw new Error('Authentication requires a resolved device identity.');
}

function mapAuthFailure(reason?: AuthFailureReason): AuthFailureState {
  switch (reason) {
    case 'otp_expired':
      return {
        code: 'OTP_EXPIRED',
        title: 'OTP expired',
        message: 'The OTP expired. Generate a new code and verify again.',
        reason,
      };
    case 'role_not_assigned':
      return {
        code: 'ACCESS_DENIED',
        title: 'Role access denied',
        message:
          'This account is not allowed to authenticate with the selected role.',
        reason,
      };
    case 'otp_mismatch':
    case 'session_not_found':
    case 'session_already_verified':
      return {
        code: 'OTP_INVALID',
        title: 'OTP invalid',
        message: 'The OTP could not be verified. Check the code and try again.',
        reason,
      };
    case 'otp_secret_missing':
    case 'user_inactive':
    case 'user_not_found':
    default:
      return {
        code:
          reason === 'user_inactive' ? 'ACCESS_DENIED' : 'AUTH_SYSTEM_ERROR',
        title:
          reason === 'user_inactive' ? 'User inactive' : 'Authentication error',
        message:
          reason === 'user_inactive'
            ? 'This account is inactive and cannot authenticate.'
            : 'The authentication system could not complete this action.',
        reason,
      };
  }
}
