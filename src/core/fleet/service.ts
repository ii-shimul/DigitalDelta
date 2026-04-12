import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import type { ActorInput, RouteMode } from '../contracts';
import { createSQLiteLedgerService } from '../auth/ledger-service';
import { tickVectorClock } from '../crdt';
import { createSQLitePodService } from '../pod';

import {
  computeOptimalRendezvous,
  evaluateDroneRequiredZone,
  type FleetGraphEdge,
  type FleetGraphNode,
} from './engine';
import {
  encodeFleetHandoffEvent,
  type FleetHandoffStatus,
} from './protocol';

type Scalar = SQLiteScalar | undefined;

export type FleetDroneRequiredZone = {
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  reachableByTruck: boolean;
  reachableBySpeedboat: boolean;
  reachableByDrone: boolean;
  droneRequired: boolean;
  reason: string;
};

export type FleetRendezvousPlan = {
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: RouteMode;
  targetVehicleId: string;
  targetVehicleType: RouteMode;
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

export type FleetHandoffEventRecord = {
  handoffId: string;
  deliveryId: string;
  sourceVehicleId: string;
  sourceVehicleType: RouteMode;
  targetVehicleId: string;
  targetVehicleType: RouteMode;
  rendezvousLatitude: number;
  rendezvousLongitude: number;
  cargoIds: string[];
  receiptId?: string;
  status: FleetHandoffStatus;
  occurredAtMs: number;
  ownershipTransferEventId?: string;
};

export type FleetHandoffTransferResult = {
  deliveryId: string;
  handoffId: string;
  receiptId: string;
  ownershipTransferEventId: string;
  rendezvousNodeId: string;
  sourceVehicleId: string;
  targetVehicleId: string;
  occurredAtMs: number;
  status: FleetHandoffStatus;
};

export interface FleetOrchestrationService {
  analyzeDroneRequiredZones(input?: {
    deliveryIds?: string[];
  }): Promise<FleetDroneRequiredZone[]>;
  computeOptimalRendezvousPlan(input: {
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetRendezvousPlan>;
  executeHandoffTransfer(input: {
    actor: ActorInput;
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetHandoffTransferResult>;
  getLatestHandoffEvent(deliveryId: string): Promise<FleetHandoffEventRecord | null>;
}

export function createSQLiteFleetOrchestrationService(
  dbProvider?: () => Promise<DatabaseHandle>,
): FleetOrchestrationService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  return new SQLiteFleetOrchestrationService(resolvedDbProvider);
}

class SQLiteFleetOrchestrationService implements FleetOrchestrationService {
  private readonly podService;

  constructor(private readonly dbProvider: () => Promise<DatabaseHandle>) {
    this.podService = createSQLitePodService(this.dbProvider);
  }

  async analyzeDroneRequiredZones(input?: {
    deliveryIds?: string[];
  }): Promise<FleetDroneRequiredZone[]> {
    const db = await this.dbProvider();
    const deliveries = await loadDeliveries(db, input?.deliveryIds);
    const edges = await loadGraphEdges(db);
    const results: FleetDroneRequiredZone[] = [];

    for (const delivery of deliveries) {
      const zone = evaluateDroneRequiredZone({
        deliveryId: delivery.deliveryId,
        originNodeId: delivery.originNodeId,
        destinationNodeId: delivery.destinationNodeId,
        edges,
      });
      results.push(zone);

      const metadata = {
        ...delivery.metadata,
        droneRequiredZone: zone.droneRequired,
        droneRequiredReason: zone.reason,
        reachability: {
          truck: zone.reachableByTruck,
          speedboat: zone.reachableBySpeedboat,
          drone: zone.reachableByDrone,
        },
      };

      await db.execute(
        `
          UPDATE deliveries
          SET
            requires_handoff = ?,
            metadata_json = ?,
            updated_at_ms = ?
          WHERE delivery_id = ?
        `,
        [zone.droneRequired ? 1 : delivery.requiresHandoff ? 1 : 0, JSON.stringify(metadata), Date.now(), delivery.deliveryId],
      );
    }

    return results;
  }

  async computeOptimalRendezvousPlan(input: {
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetRendezvousPlan> {
    const db = await this.dbProvider();
    const delivery = await requireDelivery(db, input.deliveryId);
    const nodes = await loadGraphNodes(db);
    const edges = await loadGraphEdges(db);

    const sourceVehicle = await resolveVehicle(db, {
      requestedVehicleId: input.sourceVehicleId ?? delivery.assignedVehicleId,
      fallbackType: 'speedboat',
    });
    const rendezvousSourceVehicle =
      sourceVehicle.vehicleType === 'speedboat'
        ? sourceVehicle
        : await resolveVehicle(db, {
            fallbackType: 'speedboat',
          });
    const targetVehicle = await resolveVehicle(db, {
      requestedVehicleId: input.targetVehicleId,
      fallbackType: 'drone',
    });

    const activeCargo = await loadActiveCargoForDelivery(db, input.deliveryId);
    const payloadWeightGrams = activeCargo.reduce(
      (sum, cargo) => sum + cargo.weightGrams,
      0,
    );

    const plan = computeOptimalRendezvous({
      nodes,
      edges,
      boatStartNodeId:
        rendezvousSourceVehicle.currentNodeId ?? delivery.originNodeId,
      droneStartNodeId: targetVehicle.currentNodeId ?? delivery.originNodeId,
      destinationNodeId: delivery.destinationNodeId,
      droneRangeKm: targetVehicle.rangeKm,
      payloadWeightGrams,
      dronePayloadLimitGrams: targetVehicle.payloadLimitGrams,
    });

    if (!plan.feasible || !plan.rendezvousNodeId) {
      return {
        deliveryId: delivery.deliveryId,
        sourceVehicleId: rendezvousSourceVehicle.vehicleId,
        sourceVehicleType: rendezvousSourceVehicle.vehicleType,
        targetVehicleId: targetVehicle.vehicleId,
        targetVehicleType: targetVehicle.vehicleType,
        rendezvousNodeId: '',
        rendezvousLatitude: 0,
        rendezvousLongitude: 0,
        boatEtaMinutes: 0,
        droneEtaToRendezvousMinutes: 0,
        droneEtaToDestinationMinutes: 0,
        totalEtaMinutes: 0,
        feasible: false,
        reason: plan.reason,
      };
    }

    const handoff = await upsertHandoffEvent(db, {
      deliveryId: delivery.deliveryId,
      sourceVehicleId: rendezvousSourceVehicle.vehicleId,
      sourceVehicleType: rendezvousSourceVehicle.vehicleType,
      targetVehicleId: targetVehicle.vehicleId,
      targetVehicleType: targetVehicle.vehicleType,
      rendezvousNodeId: plan.rendezvousNodeId,
      rendezvousLatitude: plan.rendezvousLatitude ?? 0,
      rendezvousLongitude: plan.rendezvousLongitude ?? 0,
      cargoIds: activeCargo.map(cargo => cargo.cargoId),
      status: 'confirmed',
      occurredAtMs: Date.now(),
    });

    const metadata = {
      ...delivery.metadata,
      rendezvousNodeId: handoff.metadata.handoffNodeId,
      rendezvousPlanComputedAtMs: handoff.occurredAtMs,
      handoffId: handoff.handoffId,
    };

    await db.execute(
      `
        UPDATE deliveries
        SET
          requires_handoff = 1,
          metadata_json = ?,
          updated_at_ms = ?
        WHERE delivery_id = ?
      `,
      [JSON.stringify(metadata), Date.now(), delivery.deliveryId],
    );

    return {
      deliveryId: delivery.deliveryId,
      sourceVehicleId: rendezvousSourceVehicle.vehicleId,
      sourceVehicleType: rendezvousSourceVehicle.vehicleType,
      targetVehicleId: targetVehicle.vehicleId,
      targetVehicleType: targetVehicle.vehicleType,
      rendezvousNodeId: plan.rendezvousNodeId,
      rendezvousLatitude: plan.rendezvousLatitude ?? 0,
      rendezvousLongitude: plan.rendezvousLongitude ?? 0,
      boatEtaMinutes: plan.boatEtaMinutes ?? 0,
      droneEtaToRendezvousMinutes: plan.droneEtaToRendezvousMinutes ?? 0,
      droneEtaToDestinationMinutes: plan.droneEtaToDestinationMinutes ?? 0,
      totalEtaMinutes: plan.totalEtaMinutes ?? 0,
      feasible: true,
    };
  }

  async executeHandoffTransfer(input: {
    actor: ActorInput;
    deliveryId: string;
    sourceVehicleId?: string;
    targetVehicleId?: string;
  }): Promise<FleetHandoffTransferResult> {
    const db = await this.dbProvider();
    const plan = await this.computeOptimalRendezvousPlan({
      deliveryId: input.deliveryId,
      sourceVehicleId: input.sourceVehicleId,
      targetVehicleId: input.targetVehicleId,
    });

    if (!plan.feasible || !plan.rendezvousNodeId) {
      throw new Error(
        plan.reason ?? 'Unable to execute handoff because no feasible rendezvous exists.',
      );
    }

    const podChallenge = await this.podService.createSignedChallenge({
      actor: input.actor,
      deliveryId: input.deliveryId,
      expiresInMs: 180_000,
    });

    const podVerification = await this.podService.verifyScannedChallenge({
      actor: input.actor,
      challengePayload: podChallenge.qrPayload,
    });

    if (podVerification.state !== 'verification-success' || !podVerification.receiptId) {
      throw new Error(
        `${podVerification.rejectionCode ?? 'POD_HANDOFF_FAILED'}: ${podVerification.rejectionReason ?? 'Recipient countersignature failed.'}`,
      );
    }

    const existingHandoff = await findLatestHandoffByDelivery(db, input.deliveryId);
    if (!existingHandoff) {
      throw new Error(`Handoff event for delivery ${input.deliveryId} not found.`);
    }

    const occurredAtMs = Date.now();
    const ownershipTransferEventId = createIdentifier('evt-own');

    const handoffBlob = encodeFleetHandoffEvent({
      handoffId: existingHandoff.handoffId,
      deliveryId: input.deliveryId,
      sourceVehicleId: plan.sourceVehicleId,
      sourceVehicleType: plan.sourceVehicleType,
      targetVehicleId: plan.targetVehicleId,
      targetVehicleType: plan.targetVehicleType,
      rendezvousLatitude: plan.rendezvousLatitude,
      rendezvousLongitude: plan.rendezvousLongitude,
      cargoIds: existingHandoff.cargoIds,
      receiptId: podVerification.receiptId,
      status: 'ownership_transferred',
      occurredAtMs,
    });

    await db.execute(
      `
        UPDATE handoff_events
        SET
          receipt_id = ?,
          status = ?,
          occurred_at_ms = ?,
          event_blob = ?,
          metadata_json = ?
        WHERE handoff_id = ?
      `,
      [
        podVerification.receiptId,
        'ownership_transferred',
        occurredAtMs,
        handoffBlob,
        JSON.stringify({
          ...existingHandoff.metadata,
          handoffNodeId: plan.rendezvousNodeId,
          ownershipTransferEventId,
          transferredAtMs: occurredAtMs,
        }),
        existingHandoff.handoffId,
      ],
    );

    const deliveryResult = await db.execute(
      `
        SELECT metadata_json AS metadataJson
        FROM deliveries
        WHERE delivery_id = ?
        LIMIT 1
      `,
      [input.deliveryId],
    );
    const deliveryMetadata = parseJsonRecord(deliveryResult.rows[0]?.metadataJson);

    await db.execute(
      `
        UPDATE deliveries
        SET
          assigned_vehicle_id = ?,
          assigned_vehicle_type = ?,
          requires_handoff = 0,
          status = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE delivery_id = ?
      `,
      [
        plan.targetVehicleId,
        plan.targetVehicleType,
        'in_transit',
        occurredAtMs,
        JSON.stringify({
          ...deliveryMetadata,
          handoffTransferred: true,
          handoffId: existingHandoff.handoffId,
          ownershipTransferEventId,
          receiptId: podVerification.receiptId,
        }),
        input.deliveryId,
      ],
    );

    const ledgerService = createSQLiteLedgerService(async () => db);
    const previousClock = await ledgerService.getLatestVectorClockForDevice(
      input.actor.deviceId,
    );
    await ledgerService.appendEvent({
      eventId: ownershipTransferEventId,
      entityType: 'handoff',
      entityId: existingHandoff.handoffId,
      eventType: 'handoff',
      actor: {
        userId: input.actor.userId,
        deviceId: input.actor.deviceId,
        role: input.actor.role,
      },
      occurredAtMs,
      vectorClock: tickVectorClock(previousClock, input.actor.deviceId),
      payloadType: 'digitaldelta.v1.fleet.handoff.transfer',
      payloadBlob: handoffBlob,
      metadata: {
        deliveryId: input.deliveryId,
        receiptId: podVerification.receiptId,
        sourceVehicleId: plan.sourceVehicleId,
        targetVehicleId: plan.targetVehicleId,
        rendezvousNodeId: plan.rendezvousNodeId,
      },
    });

    return {
      deliveryId: input.deliveryId,
      handoffId: existingHandoff.handoffId,
      receiptId: podVerification.receiptId,
      ownershipTransferEventId,
      rendezvousNodeId: plan.rendezvousNodeId,
      sourceVehicleId: plan.sourceVehicleId,
      targetVehicleId: plan.targetVehicleId,
      occurredAtMs,
      status: 'ownership_transferred',
    };
  }

  async getLatestHandoffEvent(
    deliveryId: string,
  ): Promise<FleetHandoffEventRecord | null> {
    const db = await this.dbProvider();
    const row = await findLatestHandoffByDelivery(db, deliveryId);

    if (!row) {
      return null;
    }

    return {
      handoffId: row.handoffId,
      deliveryId: row.deliveryId,
      sourceVehicleId: row.sourceVehicleId,
      sourceVehicleType: row.sourceVehicleType,
      targetVehicleId: row.targetVehicleId,
      targetVehicleType: row.targetVehicleType,
      rendezvousLatitude: row.rendezvousLatitude,
      rendezvousLongitude: row.rendezvousLongitude,
      cargoIds: row.cargoIds,
      receiptId: row.receiptId,
      status: row.status,
      occurredAtMs: row.occurredAtMs,
      ownershipTransferEventId: asOptionalString(row.metadata.ownershipTransferEventId),
    };
  }
}

async function loadGraphEdges(db: DatabaseHandle): Promise<FleetGraphEdge[]> {
  const result = await db.execute(
    `
      SELECT
        edge_id AS edgeId,
        source_node_id AS sourceNodeId,
        target_node_id AS targetNodeId,
        edge_type AS edgeType,
        status,
        travel_time_minutes AS travelTimeMinutes,
        risk_score AS riskScore
      FROM route_edges
    `,
  );

  return result.rows.map(row => ({
    edgeId: asString(row.edgeId),
    sourceNodeId: asString(row.sourceNodeId),
    targetNodeId: asString(row.targetNodeId),
    edgeType: normalizeEdgeType(asString(row.edgeType)),
    status: normalizeEdgeStatus(asString(row.status)),
    travelTimeMinutes: asNumber(row.travelTimeMinutes),
    riskScore: asNumber(row.riskScore),
  }));
}

async function loadGraphNodes(db: DatabaseHandle): Promise<FleetGraphNode[]> {
  const result = await db.execute(
    `
      SELECT
        node_id AS nodeId,
        latitude,
        longitude
      FROM network_nodes
      WHERE is_active = 1
    `,
  );

  return result.rows.map(row => ({
    nodeId: asString(row.nodeId),
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
  }));
}

async function loadDeliveries(
  db: DatabaseHandle,
  deliveryIds?: string[],
): Promise<
  Array<{
    deliveryId: string;
    originNodeId: string;
    destinationNodeId: string;
    requiresHandoff: boolean;
    assignedVehicleId?: string;
    metadata: Record<string, unknown>;
  }>
> {
  if (!deliveryIds || deliveryIds.length === 0) {
    const result = await db.execute(
      `
        SELECT
          delivery_id AS deliveryId,
          origin_node_id AS originNodeId,
          destination_node_id AS destinationNodeId,
          requires_handoff AS requiresHandoff,
          assigned_vehicle_id AS assignedVehicleId,
          metadata_json AS metadataJson
        FROM deliveries
        WHERE status NOT IN ('delivered', 'completed', 'cancelled')
      `,
    );

    return result.rows.map(row => ({
      deliveryId: asString(row.deliveryId),
      originNodeId: asString(row.originNodeId),
      destinationNodeId: asString(row.destinationNodeId),
      requiresHandoff: asNumber(row.requiresHandoff) === 1,
      assignedVehicleId: asOptionalString(row.assignedVehicleId),
      metadata: parseJsonRecord(row.metadataJson),
    }));
  }

  const placeholders = deliveryIds.map(() => '?').join(', ');
  const result = await db.execute(
    `
      SELECT
        delivery_id AS deliveryId,
        origin_node_id AS originNodeId,
        destination_node_id AS destinationNodeId,
        requires_handoff AS requiresHandoff,
        assigned_vehicle_id AS assignedVehicleId,
        metadata_json AS metadataJson
      FROM deliveries
      WHERE delivery_id IN (${placeholders})
    `,
    deliveryIds,
  );

  return result.rows.map(row => ({
    deliveryId: asString(row.deliveryId),
    originNodeId: asString(row.originNodeId),
    destinationNodeId: asString(row.destinationNodeId),
    requiresHandoff: asNumber(row.requiresHandoff) === 1,
    assignedVehicleId: asOptionalString(row.assignedVehicleId),
    metadata: parseJsonRecord(row.metadataJson),
  }));
}

async function requireDelivery(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<{
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  assignedVehicleId?: string;
  metadata: Record<string, unknown>;
}> {
  const deliveries = await loadDeliveries(db, [deliveryId]);
  const delivery = deliveries[0];

  if (!delivery) {
    throw new Error(`Delivery ${deliveryId} not found.`);
  }

  return delivery;
}

async function loadActiveCargoForDelivery(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<Array<{ cargoId: string; weightGrams: number }>> {
  const result = await db.execute(
    `
      SELECT
        cargo_id AS cargoId,
        weight_grams AS weightGrams
      FROM cargo_items
      WHERE delivery_id = ?
        AND status NOT IN ('delivered', 'cancelled', 'deposited')
      ORDER BY cargo_id ASC
    `,
    [deliveryId],
  );

  return result.rows.map(row => ({
    cargoId: asString(row.cargoId),
    weightGrams: asNumber(row.weightGrams),
  }));
}

async function resolveVehicle(
  db: DatabaseHandle,
  input: {
    requestedVehicleId?: string;
    fallbackType: RouteMode;
  },
): Promise<{
  vehicleId: string;
  vehicleType: RouteMode;
  payloadLimitGrams: number;
  currentNodeId?: string;
  rangeKm: number;
}> {
  if (input.requestedVehicleId) {
    const result = await db.execute(
      `
        SELECT
          vehicle_id AS vehicleId,
          vehicle_type AS vehicleType,
          payload_limit_grams AS payloadLimitGrams,
          current_node_id AS currentNodeId,
          metadata_json AS metadataJson
        FROM vehicles
        WHERE vehicle_id = ?
        LIMIT 1
      `,
      [input.requestedVehicleId],
    );

    const row = result.rows[0];
    if (row) {
      const metadata = parseJsonRecord(row.metadataJson);
      return {
        vehicleId: asString(row.vehicleId),
        vehicleType: normalizeRouteMode(asString(row.vehicleType)),
        payloadLimitGrams: asNumber(row.payloadLimitGrams),
        currentNodeId: asOptionalString(row.currentNodeId),
        rangeKm: asNumber(metadata.rangeKm ?? metadata.maxRangeKm) || 35,
      };
    }
  }

  const result = await db.execute(
    `
      SELECT
        vehicle_id AS vehicleId,
        vehicle_type AS vehicleType,
        payload_limit_grams AS payloadLimitGrams,
        current_node_id AS currentNodeId,
        metadata_json AS metadataJson
      FROM vehicles
      WHERE vehicle_type = ?
      ORDER BY COALESCE(last_seen_at_ms, 0) DESC, vehicle_id ASC
      LIMIT 1
    `,
    [input.fallbackType],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`No vehicle available for mode ${input.fallbackType}.`);
  }

  const metadata = parseJsonRecord(row.metadataJson);
  return {
    vehicleId: asString(row.vehicleId),
    vehicleType: normalizeRouteMode(asString(row.vehicleType)),
    payloadLimitGrams: asNumber(row.payloadLimitGrams),
    currentNodeId: asOptionalString(row.currentNodeId),
    rangeKm: asNumber(metadata.rangeKm ?? metadata.maxRangeKm) || 35,
  };
}

async function upsertHandoffEvent(
  db: DatabaseHandle,
  input: {
    deliveryId: string;
    sourceVehicleId: string;
    sourceVehicleType: RouteMode;
    targetVehicleId: string;
    targetVehicleType: RouteMode;
    rendezvousNodeId: string;
    rendezvousLatitude: number;
    rendezvousLongitude: number;
    cargoIds: string[];
    status: FleetHandoffStatus;
    occurredAtMs: number;
  },
): Promise<{
  handoffId: string;
  occurredAtMs: number;
  metadata: Record<string, unknown>;
}> {
  const existing = await findLatestHandoffByDelivery(db, input.deliveryId);
  const handoffId = existing?.handoffId ?? createIdentifier('hnd');

  const metadata = {
    ...(existing?.metadata ?? {}),
    handoffNodeId: input.rendezvousNodeId,
    rendezvousComputedAtMs: input.occurredAtMs,
  };

  await db.execute(
    `
      INSERT OR REPLACE INTO handoff_events (
        handoff_id,
        delivery_id,
        source_vehicle_id,
        source_vehicle_type,
        target_vehicle_id,
        target_vehicle_type,
        rendezvous_latitude,
        rendezvous_longitude,
        cargo_ids_json,
        receipt_id,
        status,
        occurred_at_ms,
        event_blob,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      handoffId,
      input.deliveryId,
      input.sourceVehicleId,
      input.sourceVehicleType,
      input.targetVehicleId,
      input.targetVehicleType,
      input.rendezvousLatitude,
      input.rendezvousLongitude,
      JSON.stringify(input.cargoIds),
      existing?.receiptId ?? null,
      input.status,
      input.occurredAtMs,
      null,
      JSON.stringify(metadata),
    ],
  );

  return {
    handoffId,
    occurredAtMs: input.occurredAtMs,
    metadata,
  };
}

async function findLatestHandoffByDelivery(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<
  | {
      handoffId: string;
      deliveryId: string;
      sourceVehicleId: string;
      sourceVehicleType: RouteMode;
      targetVehicleId: string;
      targetVehicleType: RouteMode;
      rendezvousLatitude: number;
      rendezvousLongitude: number;
      cargoIds: string[];
      receiptId?: string;
      status: FleetHandoffStatus;
      occurredAtMs: number;
      metadata: Record<string, unknown>;
    }
  | null
> {
  const result = await db.execute(
    `
      SELECT
        handoff_id AS handoffId,
        delivery_id AS deliveryId,
        source_vehicle_id AS sourceVehicleId,
        source_vehicle_type AS sourceVehicleType,
        target_vehicle_id AS targetVehicleId,
        target_vehicle_type AS targetVehicleType,
        rendezvous_latitude AS rendezvousLatitude,
        rendezvous_longitude AS rendezvousLongitude,
        cargo_ids_json AS cargoIdsJson,
        receipt_id AS receiptId,
        status,
        occurred_at_ms AS occurredAtMs,
        metadata_json AS metadataJson
      FROM handoff_events
      WHERE delivery_id = ?
      ORDER BY occurred_at_ms DESC, handoff_id DESC
      LIMIT 1
    `,
    [deliveryId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    handoffId: asString(row.handoffId),
    deliveryId: asString(row.deliveryId),
    sourceVehicleId: asString(row.sourceVehicleId),
    sourceVehicleType: normalizeRouteMode(asString(row.sourceVehicleType)),
    targetVehicleId: asString(row.targetVehicleId),
    targetVehicleType: normalizeRouteMode(asString(row.targetVehicleType)),
    rendezvousLatitude: asNumber(row.rendezvousLatitude),
    rendezvousLongitude: asNumber(row.rendezvousLongitude),
    cargoIds: parseJsonStringArray(row.cargoIdsJson),
    receiptId: asOptionalString(row.receiptId),
    status: normalizeHandoffStatus(asString(row.status)),
    occurredAtMs: asNumber(row.occurredAtMs),
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEdgeType(value: string): 'road' | 'waterway' | 'airway' {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'river') {
    return 'waterway';
  }

  if (normalized === 'road' || normalized === 'waterway' || normalized === 'airway') {
    return normalized;
  }

  return 'road';
}

function normalizeEdgeStatus(
  value: string,
): 'open' | 'degraded' | 'washed_out' | 'impassable' | 'high_risk' {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'open' ||
    normalized === 'degraded' ||
    normalized === 'washed_out' ||
    normalized === 'impassable' ||
    normalized === 'high_risk'
  ) {
    return normalized;
  }

  return 'open';
}

function normalizeRouteMode(value: string): RouteMode {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'boat') {
    return 'speedboat';
  }

  if (
    normalized === 'truck' ||
    normalized === 'speedboat' ||
    normalized === 'drone'
  ) {
    return normalized;
  }

  return 'truck';
}

function normalizeHandoffStatus(value: string): FleetHandoffStatus {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'pending' ||
    normalized === 'confirmed' ||
    normalized === 'ownership_transferred' ||
    normalized === 'failed'
  ) {
    return normalized;
  }

  return 'pending';
}

function parseJsonStringArray(value: Scalar | unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseJsonRecord(value: Scalar | unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: Scalar | unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar | unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar | unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
