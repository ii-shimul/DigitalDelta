import nacl from 'tweetnacl';

import {
  computeSha256Hex,
  hexToBytes,
} from '../auth/crypto';

export function signPodPayload(
  payload: Uint8Array,
  secretKeyHex: string,
): Uint8Array {
  const keyBytes = hexToBytes(secretKeyHex);
  const detached =
    keyBytes.length === nacl.sign.secretKeyLength
      ? nacl.sign.detached(payload, keyBytes)
      : nacl.sign.detached(
          payload,
          nacl.sign.keyPair.fromSeed(keyBytes.slice(0, nacl.sign.seedLength))
            .secretKey,
        );

  return new Uint8Array(detached);
}

export function verifyPodPayloadSignature(input: {
  payload: Uint8Array;
  signature: Uint8Array;
  publicKeyPem: string;
}): boolean {
  const publicKeyBytes = extractEd25519PublicKeyFromPem(input.publicKeyPem);
  if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
    return false;
  }

  return nacl.sign.detached.verify(
    input.payload,
    input.signature,
    publicKeyBytes,
  );
}

export function hashNonce(nonce: Uint8Array): string {
  return computeSha256Hex([nonce]);
}

export function extractEd25519PublicKeyFromPem(publicKeyPem: string): Uint8Array {
  const keyBytes = decodePemToDer(publicKeyPem);
  if (keyBytes.length < nacl.sign.publicKeyLength) {
    return new Uint8Array();
  }

  return keyBytes.slice(keyBytes.length - nacl.sign.publicKeyLength);
}

function decodePemToDer(publicKeyPem: string): Uint8Array {
  const base64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');

  return decodeBase64(base64);
}

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s/g, '');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];

  for (let index = 0; index < cleaned.length; index += 4) {
    const a = alphabet.indexOf(cleaned[index] ?? 'A');
    const b = alphabet.indexOf(cleaned[index + 1] ?? 'A');
    const c =
      cleaned[index + 2] === '='
        ? -1
        : alphabet.indexOf(cleaned[index + 2] ?? 'A');
    const d =
      cleaned[index + 3] === '='
        ? -1
        : alphabet.indexOf(cleaned[index + 3] ?? 'A');

    const chunk =
      ((a & 0x3f) << 18) |
      ((b & 0x3f) << 12) |
      ((Math.max(c, 0) & 0x3f) << 6) |
      (Math.max(d, 0) & 0x3f);

    output.push((chunk >> 16) & 0xff);
    if (c >= 0) {
      output.push((chunk >> 8) & 0xff);
    }
    if (d >= 0) {
      output.push(chunk & 0xff);
    }
  }

  return new Uint8Array(output);
}
