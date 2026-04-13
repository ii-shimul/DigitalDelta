import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import type {
  ActorInput,
  AppRole,
  PriorityTier,
  RouteMode,
  TriageDecisionDto,
  TriageService,
} from '../contracts';
import { encodeUtf8 } from '../auth/crypto';
import { createSQLiteLedgerService } from '../auth/ledger-service';
import { tickVectorClock } from '../crdt';
import { createSQLiteRoutingService } from '../routing';

import {
  calculateSlowdownPercent,
  DEFAULT_SLA_POLICY_MINUTES,
  groupCargoIdsByPriority,
  highestPriorityTier,
  predictCargoSlaBreaches,
  selectDroppableCargoIds,
  type CargoSlaSnapshot,
} from './engine';
import { encodeTriageDecision } from './protocol';

type Scalar = SQLiteScalar | undefined;

type DeliveryRouteContext = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  originNodeId: string;
  destinationNodeId: string;
  handoffNodeIds: string[];
};

export type TriageImpactEvaluation = {
  triggered: boolean;
  slowedByPercent: number;
  breachedCargoIds: string[];
  decision?: TriageDecisionDto;
  reroutedRouteId?: string;
};

export interface OperationalTriageService extends TriageService {
  evaluateRouteImpact(input: {
    actor: ActorInput;
    deliveryId: string;
    routeId: string;
    baselineEtaMinutes: number;
    currentEtaMinutes: number;
    nowMs: number;
    safeWaypointNodeId?: string;
  }): Promise<TriageImpactEvaluation>;
}

export function createSQLiteTriageService(
  dbProvider?: () => Promise<DatabaseHandle>,
): OperationalTriageService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  return new SQLiteTriageService(resolvedDbProvider);
}

class SQLiteTriageService implements OperationalTriageService {
  private readonly routingService: ReturnType<typeof createSQLiteRoutingService>;

  private readonly ledgerService: ReturnType<typeof createSQLiteLedgerService>;

  private readonly recordedPolicyByDevice = new Set<string>();

  constructor(private readonly dbProvider: () => Promise<DatabaseHandle>) {
    this.routingService = createSQLiteRoutingService(this.dbProvider);
    this.ledgerService = createSQLiteLedgerService(this.dbProvider);
  }

  async evaluateSlaBreach(input: {
    deliveryId: string;
    priorityTier: PriorityTier;
    currentEtaMinutes: number;
    baselineEtaMinutes: number;
    slaDeadlineMs: number;
    nowMs: number;
  }): Promise<{ breached: boolean; slowedByPercent: number }> {
    const slowedByPercent = calculateSlowdownPercent(
      input.baselineEtaMinutes,
      input.currentEtaMinutes,
    );

    const projectedArrivalMs = input.nowMs + input.currentEtaMinutes * 60_000;
    return {
      breached: projectedArrivalMs > input.slaDeadlineMs,
      slowedByPercent,
    };
  }

  async decidePreemption(input: {
    deliveryId: string;
    cargoIdsByPriority: Record<PriorityTier, string[]>;
    safeWaypointNodeId?: string;
    nowMs: number;
  }): Promise<TriageDecisionDto> {
    const highPriorityIds = [
      ...input.cargoIdsByPriority.P0,
      ...input.cargoIdsByPriority.P1,
    ];
    const lowPriorityIds = [
      ...input.cargoIdsByPriority.P2,
      ...input.cargoIdsByPriority.P3,
    ];

    const preempted = highPriorityIds.length > 0 && lowPriorityIds.length > 0;
    const droppedCargoIds = preempted ? lowPriorityIds : [];
    const remainingTiers: PriorityTier[] = [];

    if (input.cargoIdsByPriority.P0.length > 0) {
      remainingTiers.push('P0');
    }
    if (input.cargoIdsByPriority.P1.length > 0) {
      remainingTiers.push('P1');
    }
    if (!preempted && input.cargoIdsByPriority.P2.length > 0) {
      remainingTiers.push('P2');
    }
    if (!preempted && input.cargoIdsByPriority.P3.length > 0) {
      remainingTiers.push('P3');
    }

    const highestRemainingPriority = highestPriorityTier(
      remainingTiers.length > 0 ? remainingTiers : ['P3'],
    );

    const rationale = preempted
      ? `SLA risk detected: dropped ${droppedCargoIds.length} low-priority cargo items at ${input.safeWaypointNodeId ?? 'safe waypoint'} and prioritized P0/P1 payload.`
      : 'SLA risk evaluated but no eligible low-priority cargo available for autonomous drop-and-reroute.';

    return {
      decisionId: createIdentifier('tri'),
      deliveryId: input.deliveryId,
      highestRemainingPriority,
      preempted,
      droppedCargoIds,
      safeWaypointNodeId: input.safeWaypointNodeId,
      rationale,
      decidedAtMs: input.nowMs,
    };
  }

  async evaluateRouteImpact(input: {
    actor: ActorInput;
    deliveryId: string;
    routeId: string;
    baselineEtaMinutes: number;
    currentEtaMinutes: number;
    nowMs: number;
    safeWaypointNodeId?: string;
  }): Promise<TriageImpactEvaluation> {
    const db = await this.dbProvider();
    await this.recordSlaPolicy(input.actor);

    const slowedByPercent = calculateSlowdownPercent(
      input.baselineEtaMinutes,
      input.currentEtaMinutes,
    );

    if (slowedByPercent < 30) {
      return {
        triggered: false,
        slowedByPercent,
        breachedCargoIds: [],
      };
    }

    const cargoItems = await loadCargoForDelivery(db, input.deliveryId);
    if (cargoItems.length === 0) {
      return {
        triggered: true,
        slowedByPercent,
        breachedCargoIds: [],
      };
    }

    const predictions = predictCargoSlaBreaches({
      cargoItems,
      nowMs: input.nowMs,
      currentEtaMinutes: input.currentEtaMinutes,
    });
    const breachedCargoIds = predictions
      .filter(prediction => prediction.breached)
      .map(prediction => prediction.cargoId);

    const deliveryContext = await loadDeliveryRouteContext(db, input.deliveryId);
    const safeWaypointNodeId =
      input.safeWaypointNodeId ??
      deliveryContext?.handoffNodeIds[0] ??
      deliveryContext?.originNodeId;

    const droppableCargoIds = new Set(
      selectDroppableCargoIds({
        cargoItems,
        includeTiers: ['P2', 'P3'],
      }),
    );

    const preemptionCandidate = await this.decidePreemption({
      deliveryId: input.deliveryId,
      cargoIdsByPriority: {
        ...groupCargoIdsByPriority(cargoItems),
        P2: cargoItems
          .filter(
            item => item.priorityTier === 'P2' && droppableCargoIds.has(item.cargoId),
          )
          .map(item => item.cargoId),
        P3: cargoItems
          .filter(
            item => item.priorityTier === 'P3' && droppableCargoIds.has(item.cargoId),
          )
          .map(item => item.cargoId),
      },
      safeWaypointNodeId,
      nowMs: input.nowMs,
    });

    const shouldPreempt =
      breachedCargoIds.length > 0 && preemptionCandidate.preempted;

    const decision: TriageDecisionDto = {
      ...preemptionCandidate,
      preempted: shouldPreempt,
      droppedCargoIds: shouldPreempt ? preemptionCandidate.droppedCargoIds : [],
      rationale: shouldPreempt
        ? `Route slowdown ${slowedByPercent.toFixed(1)}% with ${breachedCargoIds.length} predicted SLA breach(es). ${preemptionCandidate.rationale}`
        : breachedCargoIds.length > 0
          ? `Route slowdown ${slowedByPercent.toFixed(1)}% with SLA breach risk, but no eligible P2/P3 cargo to drop.`
          : `Route slowdown ${slowedByPercent.toFixed(1)}% triggered triage evaluation. No SLA breach predicted for active cargo.`,
    };

    await persistDecision(db, decision, {
      slowedByPercent,
      breachedCargoIds,
      slaPolicyMinutes: DEFAULT_SLA_POLICY_MINUTES,
      routeId: input.routeId,
    });
    await this.appendDecisionLedgerEvent(db, input.actor, decision, {
      slowedByPercent,
      breachedCargoIds,
      routeId: input.routeId,
    });

    let reroutedRouteId: string | undefined;
    if (decision.preempted && decision.droppedCargoIds.length > 0) {
      await markDroppedCargoAtWaypoint(db, {
        deliveryId: input.deliveryId,
        droppedCargoIds: decision.droppedCargoIds,
        safeWaypointNodeId,
        nowMs: input.nowMs,
      });

      if (deliveryContext) {
        const highPriorityPayloadWeight = await sumActivePayloadWeightForTiers(db, {
          deliveryId: input.deliveryId,
          tiers: ['P0', 'P1'],
        });

        const rerouted = await this.routingService.computeRoutePlan({
          routeId: deliveryContext.routeId,
          deliveryId: deliveryContext.deliveryId,
          vehicleId: deliveryContext.vehicleId,
          vehicleType: deliveryContext.vehicleType,
          originNodeId: deliveryContext.originNodeId,
          destinationNodeId: deliveryContext.destinationNodeId,
          payloadWeightGrams: highPriorityPayloadWeight,
        });
        reroutedRouteId = rerouted.routeId;

        await this.appendRouteUpdateLedgerEvent(db, input.actor, rerouted, decision);
      }
    }

    return {
      triggered: true,
      slowedByPercent,
      breachedCargoIds,
      decision,
      reroutedRouteId,
    };
  }

  private async recordSlaPolicy(actor: ActorInput): Promise<void> {
    if (this.recordedPolicyByDevice.has(actor.deviceId)) {
      return;
    }

    const previousClock = await this.ledgerService.getLatestVectorClockForDevice(
      actor.deviceId,
    );

    await this.ledgerService.appendEvent({
      eventId: createIdentifier('evt-sla'),
      entityType: 'triage_decision',
      entityId: `sla-policy-${actor.deviceId}`,
      eventType: 'triage_decision',
      actor,
      occurredAtMs: Date.now(),
      vectorClock: tickVectorClock(previousClock, actor.deviceId),
      payloadType: 'digitaldelta.v1.triage.sla_policy',
      payloadBlob: encodeUtf8(JSON.stringify(DEFAULT_SLA_POLICY_MINUTES)),
      metadata: {
        policy: DEFAULT_SLA_POLICY_MINUTES,
      },
    });

    this.recordedPolicyByDevice.add(actor.deviceId);
  }

  private async appendDecisionLedgerEvent(
    db: DatabaseHandle,
    actor: ActorInput,
    decision: TriageDecisionDto,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const ledgerService = createSQLiteLedgerService(async () => db);
    const previousClock = await ledgerService.getLatestVectorClockForDevice(
      actor.deviceId,
    );

    await ledgerService.appendEvent({
      eventId: createIdentifier('evt-triage'),
      entityType: 'triage_decision',
      entityId: decision.decisionId,
      eventType: 'triage_decision',
      actor,
      occurredAtMs: decision.decidedAtMs,
      vectorClock: tickVectorClock(previousClock, actor.deviceId),
      payloadType: 'digitaldelta.v1.triage.decision',
      payloadBlob: encodeTriageDecision(decision),
      metadata,
    });
  }

  private async appendRouteUpdateLedgerEvent(
    db: DatabaseHandle,
    actor: ActorInput,
    route: {
      routeId: string;
      deliveryId: string;
      vehicleId: string;
      vehicleType: RouteMode;
      totalEtaMinutes: number;
      totalRiskScore: number;
      blockedEdgeIds: string[];
      handoffNodeIds: string[];
      requiresHandoff: boolean;
      computedAtMs: number;
    },
    decision: TriageDecisionDto,
  ): Promise<void> {
    const ledgerService = createSQLiteLedgerService(async () => db);
    const previousClock = await ledgerService.getLatestVectorClockForDevice(
      actor.deviceId,
    );

    await ledgerService.appendEvent({
      eventId: createIdentifier('evt-route'),
      entityType: 'route',
      entityId: route.routeId,
      eventType: 'route_updated',
      actor,
      occurredAtMs: route.computedAtMs,
      vectorClock: tickVectorClock(previousClock, actor.deviceId),
      payloadType: 'digitaldelta.v1.route.preempted',
      payloadBlob: encodeUtf8(JSON.stringify(route)),
      metadata: {
        triageDecisionId: decision.decisionId,
        droppedCargoIds: decision.droppedCargoIds,
        totalEtaMinutes: route.totalEtaMinutes,
        totalRiskScore: route.totalRiskScore,
      },
    });
  }
}

async function loadCargoForDelivery(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<CargoSlaSnapshot[]> {
  const result = await db.execute(
    `
      SELECT
        cargo_id AS cargoId,
        priority_tier AS priorityTier,
        sla_deadline_ms AS slaDeadlineMs,
        drop_allowed AS dropAllowed,
        weight_grams AS weightGrams,
        status
      FROM cargo_items
      WHERE delivery_id = ?
        AND status NOT IN ('delivered', 'cancelled', 'deposited')
      ORDER BY priority_tier ASC, cargo_id ASC
    `,
    [deliveryId],
  );

  return result.rows
    .map(row => {
      const priorityTier = normalizePriorityTier(asString(row.priorityTier));
      if (!priorityTier) {
        return null;
      }

      return {
        cargoId: asString(row.cargoId),
        priorityTier,
        slaDeadlineMs: asNumber(row.slaDeadlineMs),
        dropAllowed: asNumber(row.dropAllowed) === 1,
        weightGrams: asNumber(row.weightGrams),
        status: asString(row.status),
      } satisfies CargoSlaSnapshot;
    })
    .filter((item): item is CargoSlaSnapshot => Boolean(item));
}

async function loadDeliveryRouteContext(
  db: DatabaseHandle,
  deliveryId: string,
): Promise<DeliveryRouteContext | null> {
  const result = await db.execute(
    `
      SELECT
        COALESCE(d.current_route_id, rp.route_id, ?) AS routeId,
        d.delivery_id AS deliveryId,
        COALESCE(d.assigned_vehicle_id, rp.vehicle_id) AS vehicleId,
        COALESCE(d.assigned_vehicle_type, rp.vehicle_type) AS vehicleType,
        d.origin_node_id AS originNodeId,
        d.destination_node_id AS destinationNodeId,
        rp.handoff_node_ids_json AS handoffNodeIdsJson
      FROM deliveries d
      LEFT JOIN route_plans rp
        ON rp.route_id = d.current_route_id
      WHERE d.delivery_id = ?
      LIMIT 1
    `,
    [createIdentifier('rte'), deliveryId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    routeId: asString(row.routeId),
    deliveryId: asString(row.deliveryId),
    vehicleId: asString(row.vehicleId),
    vehicleType: normalizeRouteMode(asString(row.vehicleType)),
    originNodeId: asString(row.originNodeId),
    destinationNodeId: asString(row.destinationNodeId),
    handoffNodeIds: parseJsonStringArray(row.handoffNodeIdsJson),
  };
}

async function sumActivePayloadWeightForTiers(
  db: DatabaseHandle,
  input: {
    deliveryId: string;
    tiers: PriorityTier[];
  },
): Promise<number> {
  if (input.tiers.length === 0) {
    return 0;
  }

  const placeholders = input.tiers.map(() => '?').join(', ');
  const result = await db.execute(
    `
      SELECT
        COALESCE(SUM(weight_grams), 0) AS totalWeightGrams
      FROM cargo_items
      WHERE delivery_id = ?
        AND priority_tier IN (${placeholders})
        AND status NOT IN ('delivered', 'cancelled', 'deposited')
    `,
    [input.deliveryId, ...input.tiers],
  );

  return asNumber(result.rows[0]?.totalWeightGrams);
}

async function markDroppedCargoAtWaypoint(
  db: DatabaseHandle,
  input: {
    deliveryId: string;
    droppedCargoIds: string[];
    safeWaypointNodeId?: string;
    nowMs: number;
  },
): Promise<void> {
  for (const cargoId of input.droppedCargoIds) {
    const metadataResult = await db.execute(
      `
        SELECT metadata_json AS metadataJson
        FROM cargo_items
        WHERE cargo_id = ?
          AND delivery_id = ?
        LIMIT 1
      `,
      [cargoId, input.deliveryId],
    );

    const metadata = parseJsonRecord(metadataResult.rows[0]?.metadataJson);
    await db.execute(
      `
        UPDATE cargo_items
        SET
          status = ?,
          metadata_json = ?
        WHERE cargo_id = ?
          AND delivery_id = ?
      `,
      [
        'deposited',
        JSON.stringify({
          ...metadata,
          safeWaypointNodeId: input.safeWaypointNodeId,
          depositedAtMs: input.nowMs,
          droppedByPreemption: true,
        }),
        cargoId,
        input.deliveryId,
      ],
    );
  }
}

async function persistDecision(
  db: DatabaseHandle,
  decision: TriageDecisionDto,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.execute(
    `
      INSERT OR REPLACE INTO triage_decisions (
        decision_id,
        delivery_id,
        highest_remaining_priority,
        preempted,
        dropped_cargo_ids_json,
        safe_waypoint_node_id,
        rationale,
        decided_at_ms,
        decision_blob,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      decision.decisionId,
      decision.deliveryId,
      decision.highestRemainingPriority,
      decision.preempted ? 1 : 0,
      JSON.stringify(decision.droppedCargoIds),
      decision.safeWaypointNodeId ?? null,
      decision.rationale,
      decision.decidedAtMs,
      encodeTriageDecision(decision),
      JSON.stringify(metadata),
    ],
  );
}

function normalizePriorityTier(value: string): PriorityTier | null {
  switch (value.trim().toUpperCase()) {
    case 'P0':
      return 'P0';
    case 'P1':
      return 'P1';
    case 'P2':
      return 'P2';
    case 'P3':
      return 'P3';
    default:
      return null;
  }
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

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
