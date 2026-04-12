import type {
  AuditChainVerificationResult,
  AuthFailureReason,
} from '../contracts';

import type { AuthAuditEventType } from './constants';
import { computeSha256Bytes, encodeUtf8, timingSafeEquals } from './crypto';

export type AuthAuditLogEntry = {
  logId: string;
  authEventId: string;
  eventType: AuthAuditEventType;
  userId?: string;
  deviceId?: string;
  otpSessionId?: string;
  otpIssuedAtMs?: number;
  otpExpiresAtMs?: number;
  keyFingerprint?: string;
  failureReason?: AuthFailureReason;
  previousHash?: Uint8Array;
  payloadHash: Uint8Array;
  currentHash: Uint8Array;
  occurredAtMs: number;
  eventBlob: Uint8Array;
  metadata: Record<string, unknown>;
};

export type AuthAuditEntryInput = {
  logId: string;
  authEventId: string;
  eventType: AuthAuditEventType;
  occurredAtMs: number;
  previousHash?: Uint8Array;
  userId?: string;
  deviceId?: string;
  otpSessionId?: string;
  otpIssuedAtMs?: number;
  otpExpiresAtMs?: number;
  keyFingerprint?: string;
  failureReason?: AuthFailureReason;
  metadata?: Record<string, unknown>;
};

export function buildAuthAuditEntry(
  input: AuthAuditEntryInput,
): AuthAuditLogEntry {
  const payload = {
    authEventId: input.authEventId,
    deviceId: input.deviceId,
    eventType: input.eventType,
    failureReason: input.failureReason,
    keyFingerprint: input.keyFingerprint,
    metadata: normalizeStructuredValue(input.metadata ?? {}),
    occurredAtMs: input.occurredAtMs,
    otpExpiresAtMs: input.otpExpiresAtMs,
    otpIssuedAtMs: input.otpIssuedAtMs,
    otpSessionId: input.otpSessionId,
    userId: input.userId,
  };

  const eventBlob = encodeUtf8(stableStringify(payload));
  const payloadHash = computeSha256Bytes([eventBlob]);
  const currentHash = computeSha256Bytes([
    input.previousHash ?? new Uint8Array(),
    payloadHash,
  ]);

  return {
    logId: input.logId,
    authEventId: input.authEventId,
    eventType: input.eventType,
    userId: input.userId,
    deviceId: input.deviceId,
    otpSessionId: input.otpSessionId,
    otpIssuedAtMs: input.otpIssuedAtMs,
    otpExpiresAtMs: input.otpExpiresAtMs,
    keyFingerprint: input.keyFingerprint,
    failureReason: input.failureReason,
    previousHash: input.previousHash,
    payloadHash,
    currentHash,
    occurredAtMs: input.occurredAtMs,
    eventBlob,
    metadata: input.metadata ?? {},
  };
}

export function verifyAuthAuditEntries(
  entries: AuthAuditLogEntry[],
): AuditChainVerificationResult {
  const orderedEntries = [...entries].sort((left, right) => {
    if (left.occurredAtMs === right.occurredAtMs) {
      return left.logId.localeCompare(right.logId);
    }

    return left.occurredAtMs - right.occurredAtMs;
  });

  let previousHash: Uint8Array | undefined;

  for (let index = 0; index < orderedEntries.length; index += 1) {
    const entry = orderedEntries[index];
    const payloadHash = computeSha256Bytes([entry.eventBlob]);
    const currentHash = computeSha256Bytes([
      previousHash ?? new Uint8Array(),
      payloadHash,
    ]);

    if (!timingSafeEquals(entry.previousHash, previousHash)) {
      return {
        valid: false,
        scannedEntries: index + 1,
        brokenLogId: entry.logId,
      };
    }

    if (!timingSafeEquals(entry.payloadHash, payloadHash)) {
      return {
        valid: false,
        scannedEntries: index + 1,
        brokenLogId: entry.logId,
      };
    }

    if (!timingSafeEquals(entry.currentHash, currentHash)) {
      return {
        valid: false,
        scannedEntries: index + 1,
        brokenLogId: entry.logId,
      };
    }

    previousHash = entry.currentHash;
  }

  return {
    valid: true,
    scannedEntries: orderedEntries.length,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStructuredValue(value));
}

function normalizeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeStructuredValue(item));
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const sortedEntries = Object.keys(objectValue)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, normalizeStructuredValue(objectValue[key])] as const);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}
