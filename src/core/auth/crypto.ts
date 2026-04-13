import { sha256 } from 'js-sha256';
import * as nacl from 'tweetnacl';

declare const require: undefined | ((moduleName: string) => unknown);

const ED25519_PUBLIC_DER_PREFIX = hexToBytes('302a300506032b6570032100');
const ED25519_PRIVATE_DER_PREFIX = hexToBytes(
  '302e020100300506032b657004220420',
);

export type GeneratedEd25519KeyPair = {
  algorithm: 'ED25519';
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyDer: Uint8Array;
  privateKeyDer: Uint8Array;
  secretKey: Uint8Array;
  seed: Uint8Array;
  keyFingerprint: string;
};

export function generateEd25519KeyPair(): GeneratedEd25519KeyPair {
  const seed = randomBytes(nacl.sign.seedLength);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const publicKeyDer = concatBytes(
    ED25519_PUBLIC_DER_PREFIX,
    keyPair.publicKey,
  );
  const privateKeyDer = concatBytes(ED25519_PRIVATE_DER_PREFIX, seed);

  return {
    algorithm: 'ED25519',
    publicKeyPem: pemEncode('PUBLIC KEY', publicKeyDer),
    privateKeyPem: pemEncode('PRIVATE KEY', privateKeyDer),
    publicKeyDer,
    privateKeyDer,
    secretKey: keyPair.secretKey,
    seed,
    keyFingerprint: computeSha256Hex([publicKeyDer]).slice(0, 32),
  };
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  const runtimeCrypto = getRuntimeCrypto();
  if (runtimeCrypto) {
    runtimeCrypto.getRandomValues(bytes);
    return bytes;
  }

  if (typeof require === 'function') {
    try {
      require('react-native-get-random-values');
      const polyfilledCrypto = getRuntimeCrypto();
      if (polyfilledCrypto) {
        polyfilledCrypto.getRandomValues(bytes);
        return bytes;
      }
    } catch {}

    try {
      const nodeCrypto = require('node:crypto') as {
        randomBytes(size: number): Uint8Array;
      };
      bytes.set(nodeCrypto.randomBytes(length));
      return bytes;
    } catch {}
  }

  throw new Error('Secure random generation is unavailable in this runtime.');
}

export function computeSha256Bytes(
  parts: ReadonlyArray<string | Uint8Array | undefined | null>,
): Uint8Array {
  const digest = sha256.create();

  for (const part of parts) {
    if (typeof part === 'undefined' || part === null) {
      continue;
    }

    digest.update(typeof part === 'string' ? encodeUtf8(part) : part);
  }

  return new Uint8Array(digest.array());
}

export function computeSha256Hex(
  parts: ReadonlyArray<string | Uint8Array | undefined | null>,
): string {
  return bytesToHex(computeSha256Bytes(parts));
}

export function computeHmacSha256(
  key: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  const digest = sha256.hmac.create(key);
  digest.update(message);
  return new Uint8Array(digest.array());
}

export function encodeUtf8(value: string): Uint8Array {
  const encodedValue = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < encodedValue.length; index += 1) {
    const character = encodedValue[index];

    if (character === '%') {
      bytes.push(Number.parseInt(encodedValue.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    bytes.push(character.charCodeAt(0));
  }

  return Uint8Array.from(bytes);
}

/**
 * Decode a UTF-8 Uint8Array back to a string.
 * Hermes-safe: no TextDecoder dependency.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte < 0x80) {
      // ASCII — percent-encode only the few chars that decodeURIComponent expects
      if (
        (byte >= 0x30 && byte <= 0x39) || // 0-9
        (byte >= 0x41 && byte <= 0x5a) || // A-Z
        (byte >= 0x61 && byte <= 0x7a) || // a-z
        byte === 0x2d ||
        byte === 0x5f ||
        byte === 0x2e ||
        byte === 0x21 ||
        byte === 0x7e ||
        byte === 0x2a ||
        byte === 0x27 ||
        byte === 0x28 ||
        byte === 0x29
      ) {
        encoded += String.fromCharCode(byte);
      } else {
        encoded += '%' + byte.toString(16).padStart(2, '0').toUpperCase();
      }
    } else {
      encoded += '%' + byte.toString(16).padStart(2, '0').toUpperCase();
    }
  }
  return decodeURIComponent(encoded);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return new Uint8Array();
  }

  const padded = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  const bytes = new Uint8Array(padded.length / 2);

  for (let index = 0; index < padded.length; index += 2) {
    bytes[index / 2] = Number.parseInt(padded.slice(index, index + 2), 16);
  }

  return bytes;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return merged;
}

export function timingSafeEquals(
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
): boolean {
  const safeLeft = left ?? new Uint8Array();
  const safeRight = right ?? new Uint8Array();

  if (safeLeft.length !== safeRight.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < safeLeft.length; index += 1) {
    mismatch |= safeLeft[index] ^ safeRight[index];
  }

  return mismatch === 0;
}

function getRuntimeCrypto():
  | {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T;
    }
  | undefined {
  const runtime = globalThis as {
    crypto?: {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T;
    };
  };

  return runtime.crypto?.getRandomValues ? runtime.crypto : undefined;
}

function pemEncode(label: string, derBytes: Uint8Array): string {
  const base64 = encodeBase64(derBytes);
  const lines = base64.match(/.{1,64}/g)?.join('\n') ?? base64;

  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += alphabet[(chunk >> 18) & 0x3f];
    output += alphabet[(chunk >> 12) & 0x3f];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 0x3f] : '=';
    output += index + 2 < bytes.length ? alphabet[chunk & 0x3f] : '=';
  }

  return output;
}
