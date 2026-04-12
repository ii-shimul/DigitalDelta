/**
 * M8 Fleet API — DB orchestration for drone handoffs and battery throttling.
 */
import { getDatabase } from '../db';
import type { RegisteredUser } from './auth';
import { getEdges, getNodes, markEdge, seedRoutingGraph } from './routing';
import { createSignedDelivery, verifyAndCountersign } from './pod';
import { randomBytes } from '../core/auth/crypto';
import { bytesToHex } from '../core/auth/crypto';
import {
  type NodeReachability,
  type RendezvousResult,
  type ThrottleSimResult,
  analyzeReachability,
  computeRendezvous,
  simulateBatteryThrottling,
} from '../core/fleet/engine';

export type { NodeReachability, RendezvousResult, ThrottleSimResult };

export type DroneHandoff = {
  handoffId: string;
  deliveryId: string | null;
  vehicleNodeId: string;
  vehicleType: string;
  droneBaseNodeId: string;
  destNodeId: string;
  rendezvousNodeId: string | null;
  rendezvousLat: number | null;
  rendezvousLng: number | null;
  vehicleEtaMinutes: number | null;
  droneEtaMinutes: number | null;
  payloadWeightKg: number;
  droneMaxMinutes: number;
  status: 'computed' | 'vehicle_arrived' | 'drone_arrived' | 'completed';
  podReceiptId: string | null;
  scenarioLabel: string | null;
  createdAtMs: number;
};

// ─── Seed (ensure routing graph present) ─────────────────────────────────────

export async function ensureFleetReady(): Promise<void> {
  await seedRoutingGraph();
}

// ─── M8.1 Reachability ────────────────────────────────────────────────────────

export async function getReachabilityMap(): Promise<NodeReachability[]> {
  await ensureFleetReady();
  const [nodes, edges] = await Promise.all([getNodes(), getEdges()]);
  return analyzeReachability(nodes, edges);
}

/**
 * Simulate a flood: mark road & waterway edges to N4 as impassable,
 * making it a drone-required zone (demonstrable in UI).
 */
export async function simulateFloodScenario(): Promise<void> {
  // Fail road N2→N4 (E3) and waterway N3→N4 (E7)
  await Promise.all([
    markEdge('E3', 'impassable', 'Flood: road N2→N4 washed out'),
    markEdge('E7', 'impassable', 'Flood: waterway N3→N4 impassable'),
  ]);
}

export async function resetFloodScenario(): Promise<void> {
  await Promise.all([
    markEdge('E3', 'clear', 'Flood cleared'),
    markEdge('E7', 'clear', 'Flood cleared'),
  ]);
}

// ─── M8.2 Pre-defined Rendezvous Scenarios ───────────────────────────────────

type RendezvousScenarioParams = {
  scenarioLabel: string;
  vehicleNodeId: string;
  vehicleType: 'truck' | 'speedboat';
  droneBaseNodeId: string;
  destNodeId: string;
  droneMaxMinutes: number;
  payloadWeightKg: number;
};

export const DEMO_RENDEZVOUS_SCENARIOS: RendezvousScenarioParams[] = [
  {
    scenarioLabel: 'S1: Truck + Drone → Mohanganj (normal)',
    vehicleNodeId: 'N1',
    vehicleType: 'truck',
    droneBaseNodeId: 'N7',
    destNodeId: 'N4',
    droneMaxMinutes: 45,
    payloadWeightKg: 3,
  },
  {
    scenarioLabel: 'S2: Speedboat + Drone → Habiganj (30-min range)',
    vehicleNodeId: 'N1',
    vehicleType: 'speedboat',
    droneBaseNodeId: 'N7',
    destNodeId: 'N5',
    droneMaxMinutes: 30,
    payloadWeightKg: 2,
  },
  {
    scenarioLabel: 'S3: Truck + Drone → N4, heavy payload (overweight)',
    vehicleNodeId: 'N1',
    vehicleType: 'truck',
    droneBaseNodeId: 'N7',
    destNodeId: 'N4',
    droneMaxMinutes: 45,
    payloadWeightKg: 12,
  },
];

export async function computeDemoRendezvous(
  scenarioIdx: number,
): Promise<RendezvousResult> {
  await ensureFleetReady();
  const [nodes, edges] = await Promise.all([getNodes(), getEdges()]);
  const params = DEMO_RENDEZVOUS_SCENARIOS[scenarioIdx];
  if (!params) {
    throw new Error(`Invalid scenario index: ${scenarioIdx}`);
  }
  return computeRendezvous(params, nodes, edges);
}

// ─── Handoff CRUD ─────────────────────────────────────────────────────────────

export async function getHandoffs(): Promise<DroneHandoff[]> {
  const db = await getDatabase();
  const r = await db.execute(
    'SELECT * FROM drone_handoffs ORDER BY created_at_ms DESC LIMIT 20',
  );
  return r.rows.map(row => ({
    handoffId: row.handoff_id as string,
    deliveryId: (row.delivery_id as string | null) ?? null,
    vehicleNodeId: row.vehicle_node_id as string,
    vehicleType: row.vehicle_type as string,
    droneBaseNodeId: row.drone_base_node_id as string,
    destNodeId: row.dest_node_id as string,
    rendezvousNodeId: (row.rendezvous_node_id as string | null) ?? null,
    rendezvousLat: (row.rendezvous_lat as number | null) ?? null,
    rendezvousLng: (row.rendezvous_lng as number | null) ?? null,
    vehicleEtaMinutes: (row.vehicle_eta_minutes as number | null) ?? null,
    droneEtaMinutes: (row.drone_eta_minutes as number | null) ?? null,
    payloadWeightKg: row.payload_weight_kg as number,
    droneMaxMinutes: row.drone_max_minutes as number,
    status: row.status as DroneHandoff['status'],
    podReceiptId: (row.pod_receipt_id as string | null) ?? null,
    scenarioLabel: (row.scenario_label as string | null) ?? null,
    createdAtMs: row.created_at_ms as number,
  }));
}

/**
 * M8.2 + M8.3: Initiate a handoff — computes rendezvous and persists to DB.
 */
export async function initiateHandoff(
  user: RegisteredUser,
  scenarioIdx: number,
): Promise<{ result: RendezvousResult; handoffId: string | null }> {
  const result = await computeDemoRendezvous(scenarioIdx);

  if (!result.best) {
    return { result, handoffId: null };
  }

  const db = await getDatabase();
  const handoffId = `HND-${bytesToHex(randomBytes(5)).toUpperCase()}`;
  const nowMs = Date.now();

  await db.execute(
    `INSERT INTO drone_handoffs
       (handoff_id, vehicle_node_id, vehicle_type, drone_base_node_id, dest_node_id,
        rendezvous_node_id, rendezvous_lat, rendezvous_lng,
        vehicle_eta_minutes, drone_eta_minutes,
        payload_weight_kg, drone_max_minutes, status, scenario_label, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'computed', ?, ?)`,
    [
      handoffId,
      result.vehicleNodeId,
      result.vehicleType,
      result.droneBaseNodeId,
      result.destNodeId,
      result.best.nodeId,
      result.best.lat,
      result.best.lng,
      result.best.vehicleTimeMinutes,
      result.best.droneTimeMinutes,
      result.payloadWeightKg,
      result.droneMaxMinutes,
      result.scenarioLabel,
      nowMs,
    ],
  );

  return { result, handoffId };
}

/**
 * M8.3: Complete a handoff — vehicle arrives at rendezvous, generates PoD receipt,
 * drone counter-signs, payload ownership transfers in CRDT ledger.
 */
export async function completeHandoff(
  user: RegisteredUser,
  handoffId: string,
): Promise<{ receiptId: string | null; error?: string }> {
  const db = await getDatabase();

  // Get handoff details
  const r = await db.execute(
    'SELECT * FROM drone_handoffs WHERE handoff_id = ?',
    [handoffId],
  );
  const row = r.rows[0];
  if (!row) {
    return { receiptId: null, error: 'Handoff not found' };
  }
  if (row.status === 'completed') {
    return {
      receiptId: row.pod_receipt_id as string,
      error: 'Already completed',
    };
  }

  // Step 1: Vehicle generates a PoD QR for this delivery
  const delivery = await createSignedDelivery(user, {
    label: `Drone Handoff @ ${row.rendezvous_node_id}`,
    cargoDescription: `Fleet handoff — ${row.scenario_label ?? handoffId} — ${
      row.payload_weight_kg
    }kg`,
    recipientNodeId: row.rendezvous_node_id as string,
  });

  // Step 2: Drone "scans" and verifies (simulated on same device)
  const { result, receiptId } = await verifyAndCountersign(
    user,
    delivery.qrPayload,
  );
  if (!result.ok) {
    return {
      receiptId: null,
      error: `PoD verification failed: ${result.error}`,
    };
  }

  // Step 3: Update handoff status + link receipt & delivery
  await db.execute(
    `UPDATE drone_handoffs
     SET status = 'completed', pod_receipt_id = ?, delivery_id = ?
     WHERE handoff_id = ?`,
    [receiptId ?? null, delivery.deliveryId, handoffId],
  );

  return { receiptId: receiptId ?? null };
}

// ─── M8.4 Battery Throttle Simulation ────────────────────────────────────────

export async function runBatterySimulation(
  user: RegisteredUser,
): Promise<ThrottleSimResult> {
  const simResult = simulateBatteryThrottling();
  const db = await getDatabase();
  const nowMs = Date.now();

  // Flush any previous simulation entries for this device
  await db.execute('DELETE FROM battery_throttle_log WHERE device_id = ?', [
    user.deviceId,
  ]);

  // Persist all entries
  for (const entry of simResult.entries) {
    const logId = `BTL-${bytesToHex(randomBytes(4)).toUpperCase()}`;
    await db.execute(
      `INSERT INTO battery_throttle_log
         (log_id, device_id, simulated_time_ms, battery_pct, is_stationary,
          nearby_nodes_count, broadcast_interval_ms, reduction_pct, reason, logged_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        user.deviceId,
        entry.timeMinutes * 60_000,
        entry.batteryPct,
        entry.isStationary ? 1 : 0,
        entry.nearbyNodes,
        entry.broadcastIntervalMs,
        entry.reductionPct,
        entry.reason,
        nowMs,
      ],
    );
  }

  return simResult;
}
