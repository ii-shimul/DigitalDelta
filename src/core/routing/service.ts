import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import type { DatabaseHandle } from '../../db';
import { getDatabase } from '../../db';
import type {
  EdgeStatusUpdate,
  RouteMode,
  RoutePlanDto,
  RouteRequest,
  RoutingService,
} from '../contracts';

import {
  computeRouteFromGraph,
  type ComputeRouteEngineResult,
  type RouteEdgeStatus,
  type RoutingGraphEdge,
} from './engine';

type Scalar = SQLiteScalar | undefined;

type RecomputeContext = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  originNodeId: string;
  destinationNodeId: string;
};

export interface OperationalRoutingService extends RoutingService {
  getRecomputeContextsByEdge(edgeId: string): Promise<RecomputeContext[]>;
}

export function createSQLiteRoutingService(
  dbProvider?: () => Promise<DatabaseHandle>,
): OperationalRoutingService {
  const resolvedDbProvider = dbProvider ?? getDatabase;
  return new SQLiteRoutingService(resolvedDbProvider);
}

class SQLiteRoutingService implements OperationalRoutingService {
  constructor(private readonly dbProvider: () => Promise<DatabaseHandle>) {}

  async computeRoutePlan(request: RouteRequest): Promise<RoutePlanDto> {
    const db = await this.dbProvider();
    const edges = await this.loadGraphEdges(db);
    const deliveryContext = await this.loadDeliveryContext(db, request.deliveryId);
    const vehicleContext = await this.loadVehicleContext(db, request.vehicleId);

    const vehicleType = normalizeRouteMode(request.vehicleType);
    if (vehicleContext.vehicleType !== vehicleType) {
      throw new Error(
        `Vehicle ${request.vehicleId} is ${vehicleContext.vehicleType}, requested ${vehicleType}.`,
      );
    }

    const computed = computeRouteFromGraph({
      routeId: request.routeId,
      deliveryId: request.deliveryId,
      vehicleId: request.vehicleId,
      vehicleType,
      originNodeId: request.originNodeId,
      destinationNodeId: request.destinationNodeId,
      edges,
      blockedEdgeIds: request.blockedEdgeIds,
      payloadUnits: deliveryContext.payloadUnits,
      payloadWeightGrams: request.payloadWeightGrams ?? deliveryContext.payloadWeightGrams,
      payloadLimitGrams: vehicleContext.payloadLimitGrams,
    });

    await this.persistRoutePlan(db, computed);
    await this.updateDeliveryRoutingState(db, computed);

    if (computed.requiresHandoff) {
      await this.upsertHandoffEvent(db, {
        deliveryId: computed.deliveryId,
        sourceVehicleId: computed.vehicleId,
        sourceVehicleType: computed.vehicleType,
        handoffNodeId: computed.handoffNodeIds[0],
        targetVehicleType: computed.handoffTargetMode,
      });
    }

    return {
      routeId: computed.routeId,
      deliveryId: computed.deliveryId,
      vehicleId: computed.vehicleId,
      vehicleType: computed.vehicleType,
      legs: computed.legs,
      totalEtaMinutes: computed.totalEtaMinutes,
      totalRiskScore: computed.totalRiskScore,
      blockedEdgeIds: computed.blockedEdgeIds,
      handoffNodeIds: computed.handoffNodeIds,
      requiresHandoff: computed.requiresHandoff,
      computedAtMs: computed.computedAtMs,
    };
  }

  async updateEdgeStatus(update: EdgeStatusUpdate): Promise<void> {
    const db = await this.dbProvider();
    const existing = await db.execute(
      `
        SELECT
          travel_time_minutes AS travelTimeMinutes,
          risk_score AS riskScore,
          metadata_json AS metadataJson
        FROM route_edges
        WHERE edge_id = ?
        LIMIT 1
      `,
      [update.edgeId],
    );

    if (!existing.rows[0]) {
      throw new Error(`Edge ${update.edgeId} not found.`);
    }

    const currentTravelTime = asNumber(existing.rows[0].travelTimeMinutes);
    const currentRisk = asNumber(existing.rows[0].riskScore);
    const currentMetadata = parseJsonRecord(existing.rows[0].metadataJson);

    const nextTravelTime =
      typeof update.travelTimeMinutes === 'number'
        ? update.travelTimeMinutes
        : update.status === 'washed_out' || update.status === 'impassable'
          ? 9_999
          : currentTravelTime;
    const nextRisk =
      typeof update.riskScore === 'number'
        ? update.riskScore
        : update.status === 'washed_out' || update.status === 'impassable'
          ? Math.max(currentRisk, 0.98)
          : currentRisk;

    await db.execute(
      `
        UPDATE route_edges
        SET
          status = ?,
          travel_time_minutes = ?,
          risk_score = ?,
          last_update_reason = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE edge_id = ?
      `,
      [
        update.status,
        nextTravelTime,
        nextRisk,
        update.reason,
        update.updatedAtMs,
        JSON.stringify({
          ...currentMetadata,
          lastStatusUpdate: update.status,
          lastUpdateReason: update.reason,
        }),
        update.edgeId,
      ],
    );
  }

  async recomputeAffectedRoutes(edgeId: string): Promise<RoutePlanDto[]> {
    const contexts = await this.getRecomputeContextsByEdge(edgeId);
    const recomputed: RoutePlanDto[] = [];

    for (const context of contexts) {
      try {
        const route = await this.computeRoutePlan({
          routeId: context.routeId,
          deliveryId: context.deliveryId,
          vehicleId: context.vehicleId,
          vehicleType: context.vehicleType,
          originNodeId: context.originNodeId,
          destinationNodeId: context.destinationNodeId,
        });
        recomputed.push(route);
      } catch {
        const fallback = await this.persistUnreachableRoute(context);
        recomputed.push(fallback);
      }
    }

    return recomputed;
  }

  async getRecomputeContextsByEdge(edgeId: string): Promise<RecomputeContext[]> {
    const db = await this.dbProvider();
    const result = await db.execute(
      `
        SELECT
          rp.route_id AS routeId,
          d.delivery_id AS deliveryId,
          d.origin_node_id AS originNodeId,
          d.destination_node_id AS destinationNodeId,
          COALESCE(d.assigned_vehicle_id, rp.vehicle_id) AS vehicleId,
          COALESCE(d.assigned_vehicle_type, rp.vehicle_type) AS vehicleType
        FROM route_plans rp
        JOIN deliveries d
          ON d.delivery_id = rp.delivery_id
        WHERE rp.legs_json LIKE ?
          AND d.status NOT IN ('delivered', 'completed', 'cancelled')
        ORDER BY rp.computed_at_ms DESC
      `,
      [`%\"edgeId\":\"${edgeId}\"%`],
    );

    return result.rows
      .map(row => {
        const vehicleType = normalizeRouteMode(asString(row.vehicleType));
        const vehicleId = asOptionalString(row.vehicleId);

        if (!vehicleId) {
          return undefined;
        }

        return {
          routeId: asString(row.routeId),
          deliveryId: asString(row.deliveryId),
          originNodeId: asString(row.originNodeId),
          destinationNodeId: asString(row.destinationNodeId),
          vehicleId,
          vehicleType,
        } satisfies RecomputeContext;
      })
      .filter((value): value is RecomputeContext => Boolean(value));
  }

  private async persistUnreachableRoute(
    context: RecomputeContext,
  ): Promise<RoutePlanDto> {
    const db = await this.dbProvider();
    const computedAtMs = Date.now();
    const metadata = {
      unreachable: true,
      reason: 'No feasible path after edge status update.',
    };

    await db.execute(
      `
        INSERT OR REPLACE INTO route_plans (
          route_id,
          delivery_id,
          vehicle_id,
          vehicle_type,
          total_eta_minutes,
          total_risk_score,
          blocked_edge_ids_json,
          handoff_node_ids_json,
          legs_json,
          update_reason,
          predicted_failure_probability,
          requires_handoff,
          computed_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        context.routeId,
        context.deliveryId,
        context.vehicleId,
        context.vehicleType,
        9_999,
        1,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        'edge_status_changed',
        1,
        0,
        computedAtMs,
        JSON.stringify(metadata),
      ],
    );

    await db.execute(
      `
        UPDATE deliveries
        SET
          eta_minutes = ?,
          current_route_id = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE delivery_id = ?
      `,
      [
        9_999,
        context.routeId,
        computedAtMs,
        JSON.stringify({
          ...metadata,
          lastRouteStatus: 'unreachable',
        }),
        context.deliveryId,
      ],
    );

    return {
      routeId: context.routeId,
      deliveryId: context.deliveryId,
      vehicleId: context.vehicleId,
      vehicleType: context.vehicleType,
      legs: [],
      totalEtaMinutes: 9_999,
      totalRiskScore: 1,
      blockedEdgeIds: [],
      handoffNodeIds: [],
      requiresHandoff: false,
      computedAtMs,
    };
  }

  private async loadGraphEdges(db: DatabaseHandle): Promise<RoutingGraphEdge[]> {
    const result = await db.execute(
      `
        SELECT
          edge_id AS edgeId,
          source_node_id AS sourceNodeId,
          target_node_id AS targetNodeId,
          edge_type AS edgeType,
          status,
          travel_time_minutes AS travelTimeMinutes,
          capacity_units AS capacityUnits,
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
      capacityUnits: asNumber(row.capacityUnits),
      riskScore: asNumber(row.riskScore),
    }));
  }

  private async loadDeliveryContext(
    db: DatabaseHandle,
    deliveryId: string,
  ): Promise<{ payloadWeightGrams: number; payloadUnits: number }> {
    const result = await db.execute(
      `
        SELECT
          COALESCE(SUM(weight_grams), 0) AS payloadWeightGrams,
          COALESCE(SUM(quantity), 0) AS payloadUnits
        FROM cargo_items
        WHERE delivery_id = ?
          AND status NOT IN ('delivered', 'cancelled', 'deposited')
      `,
      [deliveryId],
    );

    return {
      payloadWeightGrams: asNumber(result.rows[0]?.payloadWeightGrams),
      payloadUnits: asNumber(result.rows[0]?.payloadUnits),
    };
  }

  private async loadVehicleContext(
    db: DatabaseHandle,
    vehicleId: string,
  ): Promise<{ vehicleType: RouteMode; payloadLimitGrams: number }> {
    const result = await db.execute(
      `
        SELECT
          vehicle_type AS vehicleType,
          payload_limit_grams AS payloadLimitGrams
        FROM vehicles
        WHERE vehicle_id = ?
        LIMIT 1
      `,
      [vehicleId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Vehicle ${vehicleId} not found.`);
    }

    return {
      vehicleType: normalizeRouteMode(asString(row.vehicleType)),
      payloadLimitGrams: asNumber(row.payloadLimitGrams),
    };
  }

  private async persistRoutePlan(
    db: DatabaseHandle,
    computed: ComputeRouteEngineResult,
  ): Promise<void> {
    await db.execute(
      `
        INSERT OR REPLACE INTO route_plans (
          route_id,
          delivery_id,
          vehicle_id,
          vehicle_type,
          total_eta_minutes,
          total_risk_score,
          blocked_edge_ids_json,
          handoff_node_ids_json,
          legs_json,
          update_reason,
          predicted_failure_probability,
          requires_handoff,
          computed_at_ms,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        computed.routeId,
        computed.deliveryId,
        computed.vehicleId,
        computed.vehicleType,
        computed.totalEtaMinutes,
        computed.totalRiskScore,
        JSON.stringify(computed.blockedEdgeIds),
        JSON.stringify(computed.handoffNodeIds),
        JSON.stringify(computed.legs.map((leg, index) => ({
          legId: `LEG-${computed.routeId}-${index + 1}`,
          edgeId: leg.edgeId,
          fromNodeId: leg.sourceNodeId,
          toNodeId: leg.targetNodeId,
          edgeType: leg.edgeType,
          vehicleType: leg.vehicleType,
          etaMinutes: leg.etaMinutes,
          riskScore: leg.riskScore,
          status: index === 0 ? 'active' : 'planned',
        }))),
        computed.updateReason,
        computed.predictedFailureProbability ?? computed.totalRiskScore,
        computed.requiresHandoff ? 1 : 0,
        computed.computedAtMs,
        JSON.stringify({
          secondaryLegs: computed.secondaryLegs,
          handoffTargetMode: computed.handoffTargetMode,
        }),
      ],
    );
  }

  private async updateDeliveryRoutingState(
    db: DatabaseHandle,
    computed: ComputeRouteEngineResult,
  ): Promise<void> {
    const currentResult = await db.execute(
      `
        SELECT metadata_json AS metadataJson
        FROM deliveries
        WHERE delivery_id = ?
        LIMIT 1
      `,
      [computed.deliveryId],
    );
    const metadata = parseJsonRecord(currentResult.rows[0]?.metadataJson);

    await db.execute(
      `
        UPDATE deliveries
        SET
          assigned_vehicle_id = ?,
          assigned_vehicle_type = ?,
          eta_minutes = ?,
          current_route_id = ?,
          requires_handoff = ?,
          updated_at_ms = ?,
          metadata_json = ?
        WHERE delivery_id = ?
      `,
      [
        computed.vehicleId,
        computed.vehicleType,
        computed.totalEtaMinutes,
        computed.routeId,
        computed.requiresHandoff ? 1 : 0,
        computed.computedAtMs,
        JSON.stringify({
          ...metadata,
          lastRouteRiskScore: computed.totalRiskScore,
          lastRouteReason: computed.updateReason,
          handoffTargetMode: computed.handoffTargetMode,
        }),
        computed.deliveryId,
      ],
    );
  }

  private async upsertHandoffEvent(
    db: DatabaseHandle,
    input: {
      deliveryId: string;
      sourceVehicleId: string;
      sourceVehicleType: RouteMode;
      handoffNodeId?: string;
      targetVehicleType?: RouteMode;
    },
  ): Promise<void> {
    const handoffNodeId = input.handoffNodeId;
    if (!handoffNodeId) {
      return;
    }

    const nodeResult = await db.execute(
      `
        SELECT latitude, longitude
        FROM network_nodes
        WHERE node_id = ?
        LIMIT 1
      `,
      [handoffNodeId],
    );

    const node = nodeResult.rows[0];
    if (!node) {
      return;
    }

    const targetVehicle = await this.findVehicleByType(
      db,
      input.targetVehicleType ?? 'drone',
      input.sourceVehicleId,
    );

    const handoffId = createIdentifier('hnd');
    const occurredAtMs = Date.now();

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
        targetVehicle.vehicleId,
        targetVehicle.vehicleType,
        asNumber(node.latitude),
        asNumber(node.longitude),
        JSON.stringify([]),
        null,
        'pending',
        occurredAtMs,
        null,
        JSON.stringify({ handoffNodeId }),
      ],
    );
  }

  private async findVehicleByType(
    db: DatabaseHandle,
    vehicleType: RouteMode,
    excludeVehicleId: string,
  ): Promise<{ vehicleId: string; vehicleType: RouteMode }> {
    const result = await db.execute(
      `
        SELECT
          vehicle_id AS vehicleId,
          vehicle_type AS vehicleType
        FROM vehicles
        WHERE vehicle_type = ?
          AND vehicle_id != ?
        ORDER BY COALESCE(last_seen_at_ms, 0) DESC, vehicle_id ASC
        LIMIT 1
      `,
      [vehicleType, excludeVehicleId],
    );

    const row = result.rows[0];
    if (!row) {
      return {
        vehicleId: excludeVehicleId,
        vehicleType,
      };
    }

    return {
      vehicleId: asString(row.vehicleId),
      vehicleType: normalizeRouteMode(asString(row.vehicleType)),
    };
  }
}

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function normalizeEdgeStatus(value: string): RouteEdgeStatus {
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
