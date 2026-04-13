import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import {
  createSQLiteAuthService,
  createSQLiteLedgerService,
  createSQLiteRoutingService,
  createSQLiteTriageService,
  encodeUtf8,
  tickVectorClock,
  type AppRole,
  type EdgeStatusUpdate,
  type RouteMode,
  type RoutePlanDto,
  type TriageDecisionDto,
} from '../core';
import { getDatabase } from '../db';

import type { AuthenticatedSession } from './auth';
import { normalizeAuthRole } from './auth';
import type { LoginScreenData } from './screen-contracts';

type Scalar = SQLiteScalar | undefined;

export type RoutingEdgeOverview = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLabel?: string;
  targetLabel?: string;
  edgeType: 'road' | 'waterway' | 'airway';
  status: 'open' | 'degraded' | 'washed_out' | 'impassable' | 'high_risk';
  travelTimeMinutes: number;
  capacityUnits: number;
  riskScore: number;
  updatedAtMs: number;
  lastUpdateReason?: string;
};

export type RoutingVehicleOverview = {
  vehicleId: string;
  displayName: string;
  vehicleType: RouteMode;
  status: string;
  currentNodeId?: string;
  batteryPercent?: number;
  assignedDeliveryId?: string;
};

export type RoutingRouteOverview = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  totalEtaMinutes: number;
  totalRiskScore: number;
  requiresHandoff: boolean;
  handoffNodeIds: string[];
  blockedEdgeIds: string[];
  updateReason?: string;
  computedAtMs: number;
  legs: RoutingLegOverview[];
};

export type RoutingLegOverview = {
  legId?: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: 'road' | 'waterway' | 'airway';
  vehicleType: RouteMode;
  etaMinutes: number;
  riskScore: number;
  status?: string;
};

export type RoutingOverview = {
  edges: RoutingEdgeOverview[];
  routes: RoutingRouteOverview[];
  vehicles: RoutingVehicleOverview[];
  capturedAtMs: number;
};

export type RoutingRecomputeResult = {
  edgeId: string;
  updatedStatus: RoutingEdgeOverview['status'];
  updatedAtMs: number;
  recomputeDurationMs: number;
  withinTwoSeconds: boolean;
  affectedRoutes: RoutePlanDto[];
  routeEventIds: string[];
  edgeEventId: string;
  triageEvaluations: RoutingTriageEvaluation[];
};

export type RoutingTriageEvaluation = {
  deliveryId: string;
  routeId: string;
  slowedByPercent: number;
  breachedCargoIds: string[];
  triggered: boolean;
  decision?: TriageDecisionDto;
  reroutedRouteId?: string;
};

export class RoutingApi {
  private readonly authService = createSQLiteAuthService();

  private readonly ledgerService = createSQLiteLedgerService();

  private readonly routingService = createSQLiteRoutingService();

  private readonly triageService = createSQLiteTriageService();

  async getRoutingOverview(): Promise<RoutingOverview> {
    const db = await getDatabase();

    const [edgesResult, routesResult, vehiclesResult] = await Promise.all([
      db.execute(
        `
          SELECT
            e.edge_id AS edgeId,
            e.source_node_id AS sourceNodeId,
            e.target_node_id AS targetNodeId,
            source.display_name AS sourceLabel,
            target.display_name AS targetLabel,
            e.edge_type AS edgeType,
            e.status,
            e.travel_time_minutes AS travelTimeMinutes,
            e.capacity_units AS capacityUnits,
            e.risk_score AS riskScore,
            e.updated_at_ms AS updatedAtMs,
            e.last_update_reason AS lastUpdateReason
          FROM route_edges e
          LEFT JOIN network_nodes source
            ON source.node_id = e.source_node_id
          LEFT JOIN network_nodes target
            ON target.node_id = e.target_node_id
          ORDER BY e.updated_at_ms DESC, e.edge_id ASC
        `,
      ),
      db.execute(
        `
          SELECT
            route_id AS routeId,
            delivery_id AS deliveryId,
            vehicle_id AS vehicleId,
            vehicle_type AS vehicleType,
            total_eta_minutes AS totalEtaMinutes,
            total_risk_score AS totalRiskScore,
            blocked_edge_ids_json AS blockedEdgeIdsJson,
            handoff_node_ids_json AS handoffNodeIdsJson,
            legs_json AS legsJson,
            update_reason AS updateReason,
            requires_handoff AS requiresHandoff,
            computed_at_ms AS computedAtMs
          FROM route_plans
          ORDER BY computed_at_ms DESC, route_id ASC
        `,
      ),
      db.execute(
        `
          SELECT
            vehicle_id AS vehicleId,
            display_name AS displayName,
            vehicle_type AS vehicleType,
            status,
            current_node_id AS currentNodeId,
            battery_percent AS batteryPercent,
            assigned_delivery_id AS assignedDeliveryId
          FROM vehicles
          ORDER BY vehicle_id ASC
        `,
      ),
    ]);

    return {
      edges: edgesResult.rows.map(row => ({
        edgeId: asString(row.edgeId),
        sourceNodeId: asString(row.sourceNodeId),
        targetNodeId: asString(row.targetNodeId),
        sourceLabel: asOptionalString(row.sourceLabel),
        targetLabel: asOptionalString(row.targetLabel),
        edgeType: normalizeEdgeType(asString(row.edgeType)),
        status: normalizeEdgeStatus(asString(row.status)),
        travelTimeMinutes: asNumber(row.travelTimeMinutes),
        capacityUnits: asNumber(row.capacityUnits),
        riskScore: asNumber(row.riskScore),
        updatedAtMs: asNumber(row.updatedAtMs),
        lastUpdateReason: asOptionalString(row.lastUpdateReason),
      })),
      routes: routesResult.rows.map(row => ({
        routeId: asString(row.routeId),
        deliveryId: asString(row.deliveryId),
        vehicleId: asString(row.vehicleId),
        vehicleType: normalizeRouteMode(asString(row.vehicleType)),
        totalEtaMinutes: asNumber(row.totalEtaMinutes),
        totalRiskScore: asNumber(row.totalRiskScore),
        requiresHandoff: Boolean(asNumber(row.requiresHandoff)),
        handoffNodeIds: parseJsonStringArray(row.handoffNodeIdsJson),
        blockedEdgeIds: parseJsonStringArray(row.blockedEdgeIdsJson),
        updateReason: asOptionalString(row.updateReason),
        computedAtMs: asNumber(row.computedAtMs),
        legs: parseRouteLegs(row.legsJson),
      })),
      vehicles: vehiclesResult.rows.map(row => ({
        vehicleId: asString(row.vehicleId),
        displayName: asString(row.displayName),
        vehicleType: normalizeRouteMode(asString(row.vehicleType)),
        status: asString(row.status),
        currentNodeId: asOptionalString(row.currentNodeId),
        batteryPercent: asOptionalNumber(row.batteryPercent),
        assignedDeliveryId: asOptionalString(row.assignedDeliveryId),
      })),
      capturedAtMs: Date.now(),
    };
  }

  async updateEdgeStatusAndRecompute(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    edgeId: string;
    status: RoutingEdgeOverview['status'];
    riskScore?: number;
    travelTimeMinutes?: number;
    reason?: EdgeStatusUpdate['reason'];
  }): Promise<RoutingRecomputeResult> {
    const actor = buildActor(input.loginData, input.session);

    await this.assertPermission(actor, 'edge_status', 'write');
    await this.assertPermission(actor, 'route', 'write');

    const impactedContexts = await this.routingService.getRecomputeContextsByEdge(
      input.edgeId,
    );
    const previousEtaByRouteId = await this.loadRouteEtaByRouteId(
      impactedContexts.map(context => context.routeId),
    );

    const update: EdgeStatusUpdate = {
      edgeId: input.edgeId,
      status: input.status,
      riskScore: input.riskScore,
      travelTimeMinutes: input.travelTimeMinutes,
      reason: input.reason ?? 'edge_status_changed',
      updatedAtMs: Date.now(),
    };

    await this.routingService.updateEdgeStatus(update);

    const recomputeStartedAt = Date.now();
    const affectedRoutes = await this.routingService.recomputeAffectedRoutes(
      input.edgeId,
    );
    const recomputeDurationMs = Date.now() - recomputeStartedAt;

    const edgeEventId = createIdentifier('evt-edge');
    const routeEventIds: string[] = [];
    const triageEvaluations: RoutingTriageEvaluation[] = [];

    let workingClock = await this.ledgerService.getLatestVectorClockForDevice(
      actor.deviceId,
    );

    workingClock = tickVectorClock(workingClock, actor.deviceId);
    await this.ledgerService.appendEvent({
      eventId: edgeEventId,
      entityType: 'edge_status',
      entityId: input.edgeId,
      eventType: 'edge_risk_updated',
      actor,
      occurredAtMs: update.updatedAtMs,
      vectorClock: workingClock,
      payloadType: 'digitaldelta.v1.route.edge_update',
      payloadBlob: encodeUtf8(
        JSON.stringify({
          edgeId: input.edgeId,
          status: input.status,
          riskScore: input.riskScore,
          travelTimeMinutes: input.travelTimeMinutes,
          reason: update.reason,
          recomputeDurationMs,
        }),
      ),
      metadata: {
        status: input.status,
        recomputeDurationMs,
        affectedRouteCount: affectedRoutes.length,
      },
    });

    for (const route of affectedRoutes) {
      const routeEventId = createIdentifier('evt-route');
      routeEventIds.push(routeEventId);
      workingClock = tickVectorClock(workingClock, actor.deviceId);

      await this.ledgerService.appendEvent({
        eventId: routeEventId,
        entityType: 'route',
        entityId: route.routeId,
        eventType: 'route_updated',
        actor,
        occurredAtMs: Date.now(),
        vectorClock: workingClock,
        payloadType: 'digitaldelta.v1.route.recomputed',
        payloadBlob: encodeUtf8(JSON.stringify(route)),
        metadata: {
          deliveryId: route.deliveryId,
          vehicleId: route.vehicleId,
          vehicleType: route.vehicleType,
          requiresHandoff: route.requiresHandoff,
          handoffNodeIds: route.handoffNodeIds,
          blockedEdgeIds: route.blockedEdgeIds,
          totalEtaMinutes: route.totalEtaMinutes,
          totalRiskScore: route.totalRiskScore,
        },
      });

      const baselineEtaMinutes = previousEtaByRouteId.get(route.routeId);
      if (
        typeof baselineEtaMinutes === 'number' &&
        Number.isFinite(baselineEtaMinutes) &&
        baselineEtaMinutes > 0
      ) {
        const triageEvaluation = await this.triageService.evaluateRouteImpact({
          actor,
          deliveryId: route.deliveryId,
          routeId: route.routeId,
          baselineEtaMinutes,
          currentEtaMinutes: route.totalEtaMinutes,
          nowMs: Date.now(),
          safeWaypointNodeId: route.handoffNodeIds[0],
        });

        triageEvaluations.push({
          deliveryId: route.deliveryId,
          routeId: route.routeId,
          slowedByPercent: triageEvaluation.slowedByPercent,
          breachedCargoIds: triageEvaluation.breachedCargoIds,
          triggered: triageEvaluation.triggered,
          decision: triageEvaluation.decision,
          reroutedRouteId: triageEvaluation.reroutedRouteId,
        });
      }
    }

    return {
      edgeId: input.edgeId,
      updatedStatus: input.status,
      updatedAtMs: update.updatedAtMs,
      recomputeDurationMs,
      withinTwoSeconds: recomputeDurationMs <= 2_000,
      affectedRoutes,
      routeEventIds,
      edgeEventId,
      triageEvaluations,
    };
  }

  async recomputeRoute(input: {
    loginData: LoginScreenData;
    session?: AuthenticatedSession;
    routeId: string;
  }): Promise<RoutePlanDto> {
    const actor = buildActor(input.loginData, input.session);
    await this.assertPermission(actor, 'route', 'write');

    const db = await getDatabase();
    const contextResult = await db.execute(
      `
        SELECT
          rp.route_id AS routeId,
          rp.delivery_id AS deliveryId,
          rp.vehicle_id AS vehicleId,
          rp.vehicle_type AS vehicleType,
          d.origin_node_id AS originNodeId,
          d.destination_node_id AS destinationNodeId
        FROM route_plans rp
        JOIN deliveries d
          ON d.delivery_id = rp.delivery_id
        WHERE rp.route_id = ?
        LIMIT 1
      `,
      [input.routeId],
    );
    const row = contextResult.rows[0];

    if (!row) {
      throw new Error(`Route ${input.routeId} not found.`);
    }

    const route = await this.routingService.computeRoutePlan({
      routeId: asString(row.routeId),
      deliveryId: asString(row.deliveryId),
      vehicleId: asString(row.vehicleId),
      vehicleType: normalizeRouteMode(asString(row.vehicleType)),
      originNodeId: asString(row.originNodeId),
      destinationNodeId: asString(row.destinationNodeId),
    });

    return route;
  }

  private async assertPermission(
    actor: { userId: string; deviceId: string; role: AppRole },
    resource: 'edge_status' | 'route',
    action: 'write',
  ): Promise<void> {
    const allowed = await this.authService.hasPermission({
      actor,
      resource,
      action,
    });

    if (!allowed) {
      throw new Error(`Role ${actor.role} is not permitted to ${action} ${resource}.`);
    }
  }

  private async loadRouteEtaByRouteId(
    routeIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueRouteIds = Array.from(new Set(routeIds.filter(Boolean)));
    if (uniqueRouteIds.length === 0) {
      return new Map();
    }

    const db = await getDatabase();
    const placeholders = uniqueRouteIds.map(() => '?').join(', ');
    const result = await db.execute(
      `
        SELECT
          route_id AS routeId,
          total_eta_minutes AS totalEtaMinutes
        FROM route_plans
        WHERE route_id IN (${placeholders})
      `,
      uniqueRouteIds,
    );

    const map = new Map<string, number>();
    for (const row of result.rows) {
      map.set(asString(row.routeId), asNumber(row.totalEtaMinutes));
    }

    return map;
  }
}

function buildActor(
  loginData: LoginScreenData,
  session?: AuthenticatedSession,
): { userId: string; deviceId: string; role: AppRole } {
  if (session) {
    return {
      userId: session.userId,
      deviceId: session.deviceId,
      role: session.activeRole,
    };
  }

  const role = normalizeAuthRole(loginData.primaryRole) ?? 'FIELD_VOLUNTEER';

  return {
    userId: loginData.userId,
    deviceId: loginData.deviceId,
    role,
  };
}

function parseRouteLegs(value: Scalar | unknown): RoutingLegOverview[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .flatMap(item => {
        if (!item || typeof item !== 'object') {
          return [];
        }

        const record = item as Record<string, unknown>;
        const leg: RoutingLegOverview = {
          legId: asOptionalString(record.legId),
          edgeId: asString(record.edgeId),
          fromNodeId: asString(record.fromNodeId ?? record.sourceNodeId),
          toNodeId: asString(record.toNodeId ?? record.targetNodeId),
          edgeType: normalizeEdgeType(asString(record.edgeType)),
          vehicleType: normalizeRouteMode(asString(record.vehicleType)),
          etaMinutes: asNumber(record.etaMinutes),
          riskScore: asNumber(record.riskScore),
          status: asOptionalString(record.status),
        };

        return leg.edgeId ? [leg] : [];
      });
  } catch {
    return [];
  }
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

    return parsed.filter(item => typeof item === 'string');
  } catch {
    return [];
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

function asOptionalNumber(value: Scalar | unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
