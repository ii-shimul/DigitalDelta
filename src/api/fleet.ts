import type { AuthenticatedSession } from './auth';
import type { LoginScreenData } from './screen-contracts';
import {
  createSQLiteAuthService,
  createSQLiteFleetOrchestrationService,
  type ActorInput,
} from '../core';

const authService = createSQLiteAuthService();
const fleetService = createSQLiteFleetOrchestrationService();

export type FleetDroneRequiredZoneSummary = {
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  reachableByTruck: boolean;
  reachableBySpeedboat: boolean;
  reachableByDrone: boolean;
  droneRequired: boolean;
  reason: string;
};

export type FleetRendezvousPlanSummary = {
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: 'truck' | 'speedboat' | 'drone';
  targetVehicleId: string;
  targetVehicleType: 'truck' | 'speedboat' | 'drone';
  rendezvousNodeId: string;
  rendezvousLatitude: number;
  rendezvousLongitude: number;
  boatEtaMinutes: number;
  droneEtaToRendezvousMinutes: number;
  droneEtaToDestinationMinutes: number;
  totalEtaMinutes: number;
  feasible: boolean;
  reason?: string;
};

export type FleetHandoffEventSummary = {
  handoffId: string;
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: 'truck' | 'speedboat' | 'drone';
  targetVehicleId: string;
  targetVehicleType: 'truck' | 'speedboat' | 'drone';
  rendezvousLatitude: number;
  rendezvousLongitude: number;
  cargoIds: string[];
  receiptId?: string;
  status: 'pending' | 'confirmed' | 'ownership_transferred' | 'failed';
  occurredAtMs: number;
  ownershipTransferEventId?: string;
};

export type FleetHandoffTransferSummary = {
  deliveryId: string;
  handoffId: string;
  receiptId: string;
  ownershipTransferEventId: string;
  rendezvousNodeId: string;
  sourceVehicleId: string;
  targetVehicleId: string;
  occurredAtMs: number;
  status: 'pending' | 'confirmed' | 'ownership_transferred' | 'failed';
};

export class FleetApi {
  async analyzeDroneRequiredZones(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryIds?: string[];
  }): Promise<FleetDroneRequiredZoneSummary[]> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'route', 'read');

    return fleetService.analyzeDroneRequiredZones({
      deliveryIds: input.deliveryIds,
    });
  }

  async computeOptimalRendezvousPlan(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetRendezvousPlanSummary> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'route', 'write');
    await assertPermission(actor, 'handoff', 'write');

    return fleetService.computeOptimalRendezvousPlan({
      deliveryId: input.deliveryId,
      sourceVehicleId: input.sourceVehicleId,
      targetVehicleId: input.targetVehicleId,
    });
  }

  async executeHandoffTransfer(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetHandoffTransferSummary> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'handoff', 'execute');
    await assertPermission(actor, 'receipt', 'execute');

    return fleetService.executeHandoffTransfer({
      actor,
      deliveryId: input.deliveryId,
      sourceVehicleId: input.sourceVehicleId,
      targetVehicleId: input.targetVehicleId,
    });
  }

  async getLatestHandoffEvent(input: {
    loginData: LoginScreenData;
    session: AuthenticatedSession;
    deliveryId: string;
  }): Promise<FleetHandoffEventSummary | null> {
    const actor = toActor(input.loginData, input.session);
    await assertPermission(actor, 'handoff', 'read');

    return fleetService.getLatestHandoffEvent(input.deliveryId);
  }
}

async function assertPermission(
  actor: ActorInput,
  resource:
    | 'route'
    | 'handoff'
    | 'receipt',
  action: 'read' | 'write' | 'execute',
): Promise<void> {
  const allowed = await authService.hasPermission({
    actor,
    resource,
    action,
  });

  if (!allowed) {
    throw new Error(`Role ${actor.role} is not permitted to ${action} ${resource}.`);
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
