import { getDatabase } from '../db';
import {
  type EdgeStatus,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type RouteResult,
  type VehicleType,
  SYLHET_EDGES,
  SYLHET_NODES,
  dijkstra,
} from '../core/routing/engine';

export type {
  EdgeType,
  EdgeStatus,
  VehicleType,
  GraphNode,
  GraphEdge,
  RouteResult,
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export async function seedRoutingGraph(): Promise<void> {
  const db = await getDatabase();
  const check = await db.execute('SELECT COUNT(*) as cnt FROM network_nodes');
  if ((check.rows[0]?.cnt as number) > 0) {
    return;
  }
  const nowMs = Date.now();
  for (const n of SYLHET_NODES) {
    await db.execute(
      `INSERT OR IGNORE INTO network_nodes
         (node_id, display_name, node_type, latitude, longitude, is_active, metadata_json, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, 1, '{}', ?)`,
      [n.nodeId, n.displayName, n.nodeType, n.lat, n.lng, nowMs],
    );
  }
  for (const e of SYLHET_EDGES) {
    await db.execute(
      `INSERT OR IGNORE INTO route_edges
         (edge_id, source_node_id, target_node_id, edge_type, status, travel_time_minutes,
          capacity_units, risk_score, updated_at_ms, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
      [
        e.edgeId,
        e.sourceNodeId,
        e.targetNodeId,
        e.edgeType,
        e.status,
        e.travelTimeMinutes,
        e.capacityUnits,
        e.riskScore,
        nowMs,
      ],
    );
  }
}

// ─── DB reads ─────────────────────────────────────────────────────────────────

export async function getNodes(): Promise<GraphNode[]> {
  const db = await getDatabase();
  const r = await db.execute(
    'SELECT node_id, display_name, node_type, latitude, longitude FROM network_nodes WHERE is_active = 1',
  );
  return r.rows.map(row => ({
    nodeId: row.node_id as string,
    displayName: row.display_name as string,
    nodeType: row.node_type as string,
    lat: row.latitude as number,
    lng: row.longitude as number,
  }));
}

export async function getEdges(): Promise<GraphEdge[]> {
  const db = await getDatabase();
  const r = await db.execute(
    'SELECT edge_id, source_node_id, target_node_id, edge_type, status, travel_time_minutes, capacity_units, risk_score FROM route_edges',
  );
  return r.rows.map(row => ({
    edgeId: row.edge_id as string,
    sourceNodeId: row.source_node_id as string,
    targetNodeId: row.target_node_id as string,
    edgeType: row.edge_type as EdgeType,
    status: row.status as EdgeStatus,
    travelTimeMinutes: row.travel_time_minutes as number,
    capacityUnits: row.capacity_units as number,
    riskScore: row.risk_score as number,
  }));
}

// ─── Route computation ────────────────────────────────────────────────────────

export async function computeRoute(
  sourceId: string,
  destId: string,
  vehicleType: VehicleType,
): Promise<RouteResult> {
  const [nodes, edges] = await Promise.all([getNodes(), getEdges()]);
  return dijkstra(nodes, edges, sourceId, destId, vehicleType);
}

// ─── Edge failure injection (M4.2) ───────────────────────────────────────────

export async function markEdge(
  edgeId: string,
  status: EdgeStatus,
  reason: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE route_edges SET status = ?, last_update_reason = ?, updated_at_ms = ? WHERE edge_id = ?`,
    [status, reason, Date.now(), edgeId],
  );
}

export async function resetAllEdges(): Promise<void> {
  const db = await getDatabase();
  const nowMs = Date.now();
  // Reset to original statuses from SYLHET_EDGES seed data
  for (const e of SYLHET_EDGES) {
    await db.execute(
      `UPDATE route_edges SET status = 'clear', risk_score = ?, last_update_reason = NULL, updated_at_ms = ?
       WHERE edge_id = ?`,
      [e.riskScore, nowMs, e.edgeId],
    );
  }
}

// ─── Reachability (M8.1 preview) ─────────────────────────────────────────────

export async function getReachability(): Promise<
  { nodeId: string; displayName: string; reachableBy: VehicleType[] }[]
> {
  const [nodes, edges] = await Promise.all([getNodes(), getEdges()]);
  const sources = ['N1', 'N7']; // HQ (trucks/boats) and Drone Base
  const vehicleSourceMap: Record<VehicleType, string> = {
    truck: 'N1',
    speedboat: 'N1',
    drone: 'N7',
  };

  return nodes
    .filter(n => n.nodeId !== 'N1' && n.nodeId !== 'N7')
    .map(n => {
      const reachableBy: VehicleType[] = [];
      for (const vt of ['truck', 'speedboat', 'drone'] as VehicleType[]) {
        const result = dijkstra(
          nodes,
          edges,
          vehicleSourceMap[vt],
          n.nodeId,
          vt,
        );
        if (result.found) {
          reachableBy.push(vt);
        }
      }
      return { nodeId: n.nodeId, displayName: n.displayName, reachableBy };
    });
}
