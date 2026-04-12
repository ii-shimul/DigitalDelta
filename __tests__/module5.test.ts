import {
  bytesToHex,
  generateEd25519KeyPair,
  randomBytes,
} from '../src/core/auth/crypto';
import {
  decodePodChallenge,
  decodePodReceipt,
  encodePodChallenge,
  encodePodReceipt,
  encodeRecipientSigningPayload,
  encodeUnsignedPodChallenge,
  type PodChallengeWire,
} from '../src/core/pod/protocol';
import {
  hashNonce,
  signPodPayload,
  verifyPodPayloadSignature,
} from '../src/core/pod/crypto';

test('module5: challenge signature verifies with sender identity key', () => {
  const senderKeys = generateEd25519KeyPair();
  const challengeCore = {
    challengeId: 'pod-ch-unit-001',
    deliveryId: 'DLV-UNIT-001',
    senderDeviceId: 'dev-alpha',
    senderUserId: 'user-alpha',
    senderPublicKeyId: senderKeys.keyFingerprint,
    payloadHash: randomBytes(32),
    nonce: randomBytes(16),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  const unsigned = encodeUnsignedPodChallenge(challengeCore);
  const signature = signPodPayload(unsigned, bytesToHex(senderKeys.secretKey));

  const challenge: PodChallengeWire = {
    ...challengeCore,
    senderSignature: {
      algorithm: 'ED25519',
      signature,
      keyId: senderKeys.keyFingerprint,
    },
  };

  const decoded = decodePodChallenge(encodePodChallenge(challenge));

  const verified = verifyPodPayloadSignature({
    payload: encodeUnsignedPodChallenge({
      challengeId: decoded.challengeId,
      deliveryId: decoded.deliveryId,
      senderDeviceId: decoded.senderDeviceId,
      senderUserId: decoded.senderUserId,
      senderPublicKeyId: decoded.senderPublicKeyId,
      payloadHash: decoded.payloadHash,
      nonce: decoded.nonce,
      issuedAtMs: decoded.issuedAtMs,
      expiresAtMs: decoded.expiresAtMs,
    }),
    signature: decoded.senderSignature?.signature ?? new Uint8Array(),
    publicKeyPem: senderKeys.publicKeyPem,
  });

  expect(verified).toBe(true);
});

test('module5: tampered challenge payload fails signature verification', () => {
  const senderKeys = generateEd25519KeyPair();
  const challengeCore = {
    challengeId: 'pod-ch-unit-002',
    deliveryId: 'DLV-UNIT-002',
    senderDeviceId: 'dev-alpha',
    senderUserId: 'user-alpha',
    senderPublicKeyId: senderKeys.keyFingerprint,
    payloadHash: randomBytes(32),
    nonce: randomBytes(16),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  const unsigned = encodeUnsignedPodChallenge(challengeCore);
  const signature = signPodPayload(unsigned, bytesToHex(senderKeys.secretKey));

  const tampered = new Uint8Array(unsigned);
  tampered[0] = (tampered[0] + 1) % 255;

  const verified = verifyPodPayloadSignature({
    payload: tampered,
    signature,
    publicKeyPem: senderKeys.publicKeyPem,
  });

  expect(verified).toBe(false);
});

test('module5: recipient countersignature is bound to challenge and recipient identity', () => {
  const senderKeys = generateEd25519KeyPair();
  const recipientKeys = generateEd25519KeyPair();

  const challengeCore = {
    challengeId: 'pod-ch-unit-003',
    deliveryId: 'DLV-UNIT-003',
    senderDeviceId: 'dev-alpha',
    senderUserId: 'user-alpha',
    senderPublicKeyId: senderKeys.keyFingerprint,
    payloadHash: randomBytes(32),
    nonce: randomBytes(16),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  const senderSignature = signPodPayload(
    encodeUnsignedPodChallenge(challengeCore),
    bytesToHex(senderKeys.secretKey),
  );

  const challengeBytes = encodePodChallenge({
    ...challengeCore,
    senderSignature: {
      algorithm: 'ED25519',
      signature: senderSignature,
      keyId: senderKeys.keyFingerprint,
    },
  });

  const recipientSigningPayload = encodeRecipientSigningPayload({
    challengeBytes,
    recipientUserId: 'user-beta',
    recipientDeviceId: 'dev-beta',
    verifiedAtMs: Date.now(),
  });

  const recipientSignature = signPodPayload(
    recipientSigningPayload,
    bytesToHex(recipientKeys.secretKey),
  );

  const verified = verifyPodPayloadSignature({
    payload: recipientSigningPayload,
    signature: recipientSignature,
    publicKeyPem: recipientKeys.publicKeyPem,
  });

  expect(verified).toBe(true);
});

test('module5: receipt wire format preserves replay rejection status and code', () => {
  const senderKeys = generateEd25519KeyPair();
  const challengeCore = {
    challengeId: 'pod-ch-unit-004',
    deliveryId: 'DLV-UNIT-004',
    senderDeviceId: 'dev-alpha',
    senderUserId: 'user-alpha',
    senderPublicKeyId: senderKeys.keyFingerprint,
    payloadHash: randomBytes(32),
    nonce: randomBytes(16),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  const receiptBytes = encodePodReceipt({
    receiptId: 'pod-rcpt-004',
    deliveryId: challengeCore.deliveryId,
    status: 'REPLAY_REJECTED',
    challenge: {
      ...challengeCore,
      senderSignature: {
        algorithm: 'ED25519',
        signature: signPodPayload(
          encodeUnsignedPodChallenge(challengeCore),
          bytesToHex(senderKeys.secretKey),
        ),
        keyId: senderKeys.keyFingerprint,
      },
    },
    rejectionCode: 'REPLAY_NONCE_USED',
    rejectionReason: 'Nonce has already been consumed by a prior receipt.',
  });

  const decoded = decodePodReceipt(receiptBytes);

  expect(decoded.status).toBe('REPLAY_REJECTED');
  expect(decoded.rejectionCode).toBe('REPLAY_NONCE_USED');
  expect(hashNonce(decoded.challenge.nonce)).toHaveLength(64);
});
