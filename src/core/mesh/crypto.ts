import * as nacl from 'tweetnacl';
import * as ed2curve from 'ed2curve';

import { computeSha256Hex, hexToBytes, randomBytes } from '../auth/crypto';

export type MeshKeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export type MeshEncryptedPayload = {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  payloadHashHex: string;
};

export function generateMeshKeyPair(): MeshKeyPair {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: new Uint8Array(keyPair.publicKey),
    secretKey: new Uint8Array(keyPair.secretKey),
  };
}

export function deriveMeshPublicKeyFromEd25519PublicPem(
  publicKeyPem: string,
): Uint8Array {
  const edPublic = extractEd25519PublicKeyFromPem(publicKeyPem);
  const converted = ed2curve.convertPublicKey(edPublic);

  if (!converted) {
    throw new Error('Unable to derive mesh public key from Ed25519 public key.');
  }

  return new Uint8Array(converted);
}

export function deriveMeshKeyPairFromIdentity(input: {
  publicKeyPem: string;
  secretKeyHex: string;
}): MeshKeyPair {
  const edPublic = extractEd25519PublicKeyFromPem(input.publicKeyPem);
  const edSecret = hexToBytes(input.secretKeyHex);

  const convertedPublic = ed2curve.convertPublicKey(edPublic);
  const convertedSecret = ed2curve.convertSecretKey(edSecret);

  if (!convertedPublic || !convertedSecret) {
    throw new Error('Unable to derive mesh key pair from Ed25519 identity material.');
  }

  return {
    publicKey: new Uint8Array(convertedPublic),
    secretKey: new Uint8Array(convertedSecret),
  };
}

export function encryptForRecipient(input: {
  plaintext: Uint8Array;
  senderSecretKey: Uint8Array;
  recipientPublicKey: Uint8Array;
  nonce?: Uint8Array;
}): MeshEncryptedPayload {
  const nonce = input.nonce ?? randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    input.plaintext,
    nonce,
    input.recipientPublicKey,
    input.senderSecretKey,
  );

  return {
    nonce: new Uint8Array(nonce),
    ciphertext: new Uint8Array(ciphertext),
    payloadHashHex: computeSha256Hex([input.plaintext]),
  };
}

export function decryptFromSender(input: {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  senderPublicKey: Uint8Array;
  recipientSecretKey: Uint8Array;
}): Uint8Array | null {
  const plaintext = nacl.box.open(
    input.ciphertext,
    input.nonce,
    input.senderPublicKey,
    input.recipientSecretKey,
  );

  return plaintext ? new Uint8Array(plaintext) : null;
}

export function bytesToBase64(bytes: Uint8Array): string {
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

export function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s/g, '');
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

function extractEd25519PublicKeyFromPem(publicKeyPem: string): Uint8Array {
  const der = decodePemToDer(publicKeyPem);
  if (der.length < 32) {
    throw new Error('Invalid Ed25519 public key PEM payload.');
  }

  return der.slice(der.length - 32);
}

function decodePemToDer(publicKeyPem: string): Uint8Array {
  const base64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');

  return base64ToBytes(base64);
}
