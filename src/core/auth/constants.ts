import type { OfflineOtpAlgorithm } from '../contracts';

export const OFFLINE_OTP_ALGORITHM: OfflineOtpAlgorithm = 'TOTP-SHA256';
export const OFFLINE_OTP_DIGITS = 6;
export const OFFLINE_OTP_PERIOD_SECONDS = 30;

export const AUTH_PAYLOAD_TYPE_PREFIX = 'digitaldelta.v1.auth';

export const AUTH_AUDIT_EVENT_TYPES = {
  otpIssued: 'otp_issued',
  loginSuccess: 'login_success',
  loginFailure: 'login_failure',
  keyProvisioned: 'key_provisioned',
  keyRotated: 'key_rotated',
} as const;

export type AuthAuditEventType =
  (typeof AUTH_AUDIT_EVENT_TYPES)[keyof typeof AUTH_AUDIT_EVENT_TYPES];
