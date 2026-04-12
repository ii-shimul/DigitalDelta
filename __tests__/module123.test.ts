import {
  generateEd25519KeyPair,
  decodeUtf8,
  bytesToHex,
  encodeUtf8,
} from '../src/core/auth/crypto';
import { mergeInventoryLwwRegister } from '../src/core/mesh/inventory-lww-register';
import {
  deriveMeshKeyPairFromIdentity,
  deriveMeshPublicKeyFromEd25519PublicPem,
  encryptForRecipient,
  decryptFromSender,
} from '../src/core/mesh/crypto';

test('module2: CRDT merge preserves causal after relation', () => {
  const result = mergeInventoryLwwRegister({
    local: {
      quantity: 10,
      vectorClock: { 'DEV-A': 1 },
      occurredAtMs: 1000,
      eventId: 'evt-local',
    },
    remote: {
      quantity: 13,
      vectorClock: { 'DEV-A': 2 },
      occurredAtMs: 1200,
      eventId: 'evt-remote',
    },
  });

  expect(result.quantity).toBe(13);
  expect(result.chosenSource).toBe('remote');
  expect(result.concurrentConflict).toBe(false);
  expect(result.vectorClock).toEqual({ 'DEV-A': 2 });
});

test('module2: CRDT merge detects concurrent conflict', () => {
  const result = mergeInventoryLwwRegister({
    local: {
      quantity: 9,
      vectorClock: { 'DEV-A': 2 },
      occurredAtMs: 1300,
      eventId: 'evt-a',
    },
    remote: {
      quantity: 5,
      vectorClock: { 'DEV-B': 1 },
      occurredAtMs: 1301,
      eventId: 'evt-b',
    },
  });

  expect(result.concurrentConflict).toBe(true);
  expect(result.vectorClock).toEqual({ 'DEV-A': 2, 'DEV-B': 1 });
});

test('module3: derives mesh key pair from module1 identity keys', () => {
  const identity = generateEd25519KeyPair();

  const meshFromIdentity = deriveMeshKeyPairFromIdentity({
    publicKeyPem: identity.publicKeyPem,
    secretKeyHex: bytesToHex(identity.secretKey),
  });

  const meshPublicFromPem = deriveMeshPublicKeyFromEd25519PublicPem(
    identity.publicKeyPem,
  );

  expect(meshFromIdentity.publicKey.length).toBe(32);
  expect(meshFromIdentity.secretKey.length).toBe(32);
  expect(Array.from(meshFromIdentity.publicKey)).toEqual(
    Array.from(meshPublicFromPem),
  );
});

test('module3: end-to-end payload decrypts only for recipient', () => {
  const senderIdentity = generateEd25519KeyPair();
  const recipientIdentity = generateEd25519KeyPair();
  const relayIdentity = generateEd25519KeyPair();

  const senderMesh = deriveMeshKeyPairFromIdentity({
    publicKeyPem: senderIdentity.publicKeyPem,
    secretKeyHex: bytesToHex(senderIdentity.secretKey),
  });
  const recipientMesh = deriveMeshKeyPairFromIdentity({
    publicKeyPem: recipientIdentity.publicKeyPem,
    secretKeyHex: bytesToHex(recipientIdentity.secretKey),
  });
  const relayMesh = deriveMeshKeyPairFromIdentity({
    publicKeyPem: relayIdentity.publicKeyPem,
    secretKeyHex: bytesToHex(relayIdentity.secretKey),
  });

  const encrypted = encryptForRecipient({
    plaintext: encodeUtf8('critical-supplies-payload'),
    senderSecretKey: senderMesh.secretKey,
    recipientPublicKey: recipientMesh.publicKey,
  });

  const recipientPlaintext = decryptFromSender({
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    senderPublicKey: senderMesh.publicKey,
    recipientSecretKey: recipientMesh.secretKey,
  });

  expect(recipientPlaintext).not.toBeNull();
  expect(decodeUtf8(recipientPlaintext ?? new Uint8Array())).toBe(
    'critical-supplies-payload',
  );

  const relayPlaintext = decryptFromSender({
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    senderPublicKey: senderMesh.publicKey,
    recipientSecretKey: relayMesh.secretKey,
  });

  expect(relayPlaintext).toBeNull();
});
