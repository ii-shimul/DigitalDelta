import type { LoginScreenData } from './screen-contracts';

export const AUTH_ROLES = [
  'FIELD_VOLUNTEER',
  'SUPPLY_MANAGER',
  'DRONE_OPERATOR',
  'CAMP_COMMANDER',
  'SYNC_ADMIN',
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export type AuthErrorCode =
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'ACCESS_DENIED'
  | 'KEY_NOT_PROVISIONED';

export type OtpSession = {
  otpSessionId: string;
  userId: string;
  selectedRole: AuthRole;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type AuthenticatedSession = {
  userId: string;
  displayName: string;
  activeRole: AuthRole;
  roles: AuthRole[];
  authenticatedAtMs: number;
};

export type OtpVerificationResult =
  | {
      ok: true;
      authenticated: AuthenticatedSession;
      keyProvisioningRequired: boolean;
    }
  | {
      ok: false;
      errorCode: AuthErrorCode;
      message: string;
    };

const OTP_WINDOW_MS = 90 * 1000;

export class AuthPlaceholderAdapter {
  private readonly nowFn: () => number;

  constructor(nowFn?: () => number) {
    this.nowFn = nowFn ?? (() => Date.now());
  }

  requestOtp(userId: string, selectedRole: AuthRole): OtpSession {
    const issuedAtMs = this.nowFn();
    return {
      otpSessionId: `otp-${userId}-${issuedAtMs}`,
      userId,
      selectedRole,
      issuedAtMs,
      expiresAtMs: issuedAtMs + OTP_WINDOW_MS,
    };
  }

  verifyOtp(
    input: {
      loginData: LoginScreenData;
      otpCode: string;
      otpSession: OtpSession;
    },
  ): OtpVerificationResult {
    const nowMs = this.nowFn();
    const normalizedCode = input.otpCode.trim();

    if (normalizedCode.length !== 6 || normalizedCode === '111111') {
      return {
        ok: false,
        errorCode: 'OTP_INVALID',
        message: 'The OTP code is invalid. Enter a valid 6-digit OTP.',
      };
    }

    if (nowMs > input.otpSession.expiresAtMs || normalizedCode === '000000') {
      return {
        ok: false,
        errorCode: 'OTP_EXPIRED',
        message: 'The OTP expired. Request a new OTP and try again.',
      };
    }

    const roleSet = new Set(
      input.loginData.roles.map(role => normalizeRole(role)).filter(Boolean),
    );

    if (!roleSet.has(input.otpSession.selectedRole)) {
      return {
        ok: false,
        errorCode: 'ACCESS_DENIED',
        message:
          'Access denied for this role. Use a permitted role for this account.',
      };
    }

    if (!input.loginData.keyProvisioned || normalizedCode === '999999') {
      return {
        ok: false,
        errorCode: 'KEY_NOT_PROVISIONED',
        message:
          'Device key pair is not provisioned yet. Complete key setup first.',
      };
    }

    return {
      ok: true,
      keyProvisioningRequired: false,
      authenticated: {
        userId: input.loginData.userId,
        displayName: input.loginData.displayName,
        activeRole: input.otpSession.selectedRole,
        roles: Array.from(roleSet),
        authenticatedAtMs: nowMs,
      },
    };
  }
}

function normalizeRole(value: string): AuthRole | null {
  const normalizedValue = value.trim().toUpperCase();
  const matchedRole = AUTH_ROLES.find(role => role === normalizedValue);
  return matchedRole ?? null;
}
