import type { AuthenticatedSession } from './auth';
import type { LoginScreenData, PodReceiptData } from './screen-contracts';
import {
  createSQLiteAuthService,
  createSQLitePodService,
  type ActorInput,
  type PodVerificationState,
} from '../core';

const authService = createSQLiteAuthService();
const podService = createSQLitePodService();

export type PodChallengeEnvelope = {
  receiptId: string;
  challengeId: string;
  deliveryId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  senderDeviceId: string;
  senderPublicKeyId: string;
  payloadHashHex: string;
  qrPayload: string;
};

export type PodVerificationOutcome = {
  receiptId?: string;
  challengeId?: string;
  deliveryId?: string;
  state: PodVerificationState;
  rejectionCode?: string;
  rejectionReason?: string;
  verifiedAtMs?: number;
};

export class PodApi {
  async createSignedChallenge(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryId: string;
  }): Promise<PodChallengeEnvelope> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'write');

    return podService.createSignedChallenge({
      actor,
      deliveryId: input.deliveryId,
    });
  }

  async verifyScannedChallenge(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    challengePayload: string;
  }): Promise<PodVerificationOutcome> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'execute');

    return podService.verifyScannedChallenge({
      actor,
      challengePayload: input.challengePayload,
    });
  }

  async getLatestReceipt(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryId: string;
  }): Promise<PodReceiptData | null> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'read');

    const latestReceipt = await podService.getLatestReceiptForDelivery(
      input.deliveryId,
    );

    if (!latestReceipt) {
      return null;
    }

    return {
      receiptId: latestReceipt.receiptId,
      challengeId: latestReceipt.challengeId,
      status: latestReceipt.status,
      senderDeviceId: latestReceipt.senderDeviceId,
      recipientDeviceId: latestReceipt.recipientDeviceId,
      issuedAtMs: latestReceipt.issuedAtMs,
      expiresAtMs: latestReceipt.expiresAtMs,
      verifiedAtMs: latestReceipt.verifiedAtMs,
      rejectionCode: latestReceipt.rejectionCode,
      rejectionReason: latestReceipt.rejectionReason,
    };
  }
}

async function assertPermission(
  actor: ActorInput,
  action: 'read' | 'write' | 'execute',
): Promise<void> {
  const allowed = await authService.hasPermission({
    actor,
    resource: 'receipt',
    action,
  });

  if (!allowed) {
    throw new Error(
      `Role ${actor.role} is not permitted to ${action} proof-of-delivery receipts.`,
    );
  }
}

function toActor(
  loginData: LoginScreenData,
  session: AuthenticatedSession,
): ActorInput {
  return {
    userId: loginData.userId,
    deviceId: session.deviceId,
    role: session.activeRole,
    displayName: session.displayName,
  };
}
