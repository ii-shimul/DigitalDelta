import type { AuthFailureReason } from '../contracts';

import {
  OFFLINE_OTP_ALGORITHM,
  OFFLINE_OTP_DIGITS,
  OFFLINE_OTP_PERIOD_SECONDS,
} from './constants';
import {
  bytesToHex,
  computeHmacSha256,
  hexToBytes,
  randomBytes,
} from './crypto';

export function generateOtpSecretHex(byteLength = 32): string {
  return bytesToHex(randomBytes(byteLength));
}

export function buildIssuedOtp(input: {
  secretHex: string;
  issuedAtMs: number;
  digits?: number;
  periodSeconds?: number;
}) {
  const digits = input.digits ?? OFFLINE_OTP_DIGITS;
  const periodSeconds = input.periodSeconds ?? OFFLINE_OTP_PERIOD_SECONDS;
  const counter = getOtpCounter(input.issuedAtMs, periodSeconds);

  return {
    algorithm: OFFLINE_OTP_ALGORITHM,
    digits,
    periodSeconds,
    counter,
    expiresAtMs: getOtpExpiryAtMs(counter, periodSeconds),
    code: generateTotpCode(input.secretHex, counter, digits),
  };
}

export function validateIssuedOtpCode(input: {
  secretHex: string;
  counter: number;
  code: string;
  verifiedAtMs: number;
  expiresAtMs: number;
  digits?: number;
}): { matched: boolean; failureReason?: AuthFailureReason } {
  if (input.verifiedAtMs > input.expiresAtMs) {
    return {
      matched: false,
      failureReason: 'otp_expired',
    };
  }

  const expectedCode = generateTotpCode(
    input.secretHex,
    input.counter,
    input.digits ?? OFFLINE_OTP_DIGITS,
  );

  if (expectedCode !== input.code) {
    return {
      matched: false,
      failureReason: 'otp_mismatch',
    };
  }

  return { matched: true };
}

export function getOtpCounter(
  timestampMs: number,
  periodSeconds = OFFLINE_OTP_PERIOD_SECONDS,
): number {
  return Math.floor(timestampMs / (periodSeconds * 1000));
}

export function getOtpExpiryAtMs(
  counter: number,
  periodSeconds = OFFLINE_OTP_PERIOD_SECONDS,
): number {
  return (counter + 1) * periodSeconds * 1000;
}

export function generateTotpCode(
  secretHex: string,
  counter: number,
  digits = OFFLINE_OTP_DIGITS,
): string {
  const key = hexToBytes(secretHex);
  const counterBytes = new Uint8Array(8);
  let value = BigInt(counter);

  for (let index = counterBytes.length - 1; index >= 0; index -= 1) {
    counterBytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  const digest = computeHmacSha256(key, counterBytes);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otpValue = binary % 10 ** digits;
  return otpValue.toString().padStart(digits, '0');
}
