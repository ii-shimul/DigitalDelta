/**
 * M8 – Hybrid Fleet Orchestration & Drone Handoff Logic
 *
 * M8.1 Reachability Analysis
 * M8.2 Optimal Rendezvous Point Computation
 * M8.4 Battery-Aware Mesh Throttling
 */
import {
  type GraphEdge,
  type GraphNode,
  type VehicleType,
  dijkstra,
} from '../routing/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeReachability = {
  nodeId: string;
  displayName: string;
  lat: number;
  lng: number;
  nodeType: string;
  reachableByTruck: boolean;
  reachableByBoat: boolean;
  reachableByDrone: boolean;
  droneRequired: boolean; // unreachable by ground, reachable by drone
  isolated: boolean; // unreachable by any mode
};

export type RendezvousCandidate = {
  nodeId: string;
  displayName: string;
  lat: number;
  lng: number;
  vehicleTimeMinutes: number;
  droneTimeMinutes: number;
  meetTimeMinutes: number; // max(v, d) — when both agents arrive
};

export type RendezvousResult = {
  scenarioLabel: string;
  vehicleNodeId: string;
  vehicleType: 'truck' | 'speedboat';
  droneBaseNodeId: string;
  destNodeId: string;
  droneMaxMinutes: number;
  payloadWeightKg: number;
  best: RendezvousCandidate | null;
  allCandidates: RendezvousCandidate[];
  constraintViolation: string | null;
};

export type ThrottleEntry = {
  timeMinutes: number;
  batteryPct: number;
  isStationary: boolean;
  nearbyNodes: number;
  broadcastIntervalMs: number;
  reductionPct: number;
  reason: string;
};

export type ThrottleSimResult = {
  entries: ThrottleEntry[];
  baselineBroadcasts: number; // broadcasts in 10 min at base rate
  actualBroadcasts: number;
  savedBroadcasts: number;
  savedPct: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const DRONE_MAX_PAYLOAD_KG = 5;
export const BASE_BROADCAST_INTERVAL_MS = 5_000; // 5 s nominal

// Main depot + drone base for reachability analysis
const DEPOT_IDS = ['N1', 'N5'];
const DRONE_BASE_ID = 'N7';

// ─── M8.1 Reachability Analysis ───────────────────────────────────────────────

export function analyzeReachability(
  nodes: GraphNode[],
  edges: GraphEdge[],
): NodeReachability[] {
  return nodes.map(node => {
    // Depots and drone bases are always considered reachable by their owners
    if (node.nodeType === 'depot' || node.nodeType === 'drone_base') {
      return {
        nodeId: node.nodeId,
        displayName: node.displayName,
        lat: node.lat,
        lng: node.lng,
        nodeType: node.nodeType,
        reachableByTruck: true,
        reachableByBoat: true,
        reachableByDrone: true,
        droneRequired: false,
        isolated: false,
      };
    }

    let byTruck = false;
    let byBoat = false;
    let byDrone = false;

    for (const depotId of DEPOT_IDS) {
      if (!byTruck) {
        byTruck = dijkstra(nodes, edges, depotId, node.nodeId, 'truck').found;
      }
      if (!byBoat) {
        byBoat = dijkstra(
          nodes,
          edges,
          depotId,
          node.nodeId,
          'speedboat',
        ).found;
      }
    }

    byDrone = dijkstra(nodes, edges, DRONE_BASE_ID, node.nodeId, 'drone').found;

    const groundReachable = byTruck || byBoat;
    return {
      nodeId: node.nodeId,
      displayName: node.displayName,
      lat: node.lat,
      lng: node.lng,
      nodeType: node.nodeType,
      reachableByTruck: byTruck,
      reachableByBoat: byBoat,
      reachableByDrone: byDrone,
      droneRequired: !groundReachable && byDrone,
      isolated: !groundReachable && !byDrone,
    };
  });
}

// ─── M8.2 Rendezvous Computation ──────────────────────────────────────────────

export function computeRendezvous(
  params: {
    scenarioLabel: string;
    vehicleNodeId: string;
    vehicleType: 'truck' | 'speedboat';
    droneBaseNodeId: string;
    destNodeId: string;
    droneMaxMinutes: number;
    payloadWeightKg: number;
  },
  nodes: GraphNode[],
  edges: GraphEdge[],
): RendezvousResult {
  const base: Omit<
    RendezvousResult,
    'best' | 'allCandidates' | 'constraintViolation'
  > = {
    scenarioLabel: params.scenarioLabel,
    vehicleNodeId: params.vehicleNodeId,
    vehicleType: params.vehicleType,
    droneBaseNodeId: params.droneBaseNodeId,
    destNodeId: params.destNodeId,
    droneMaxMinutes: params.droneMaxMinutes,
    payloadWeightKg: params.payloadWeightKg,
  };

  // M8.2: Payload weight constraint
  if (params.payloadWeightKg > DRONE_MAX_PAYLOAD_KG) {
    return {
      ...base,
      best: null,
      allCandidates: [],
      constraintViolation: `Payload ${params.payloadWeightKg} kg exceeds drone capacity (${DRONE_MAX_PAYLOAD_KG} kg) — air delivery impossible`,
    };
  }

  const candidates: RendezvousCandidate[] = [];

  for (const node of nodes) {
    // The rendezvous is any node the vehicle can reach en-route
    // (excluding the drone base itself as a meeting point)
    if (node.nodeId === params.droneBaseNodeId) continue;

    // Can the vehicle get there?
    const vResult = dijkstra(
      nodes,
      edges,
      params.vehicleNodeId,
      node.nodeId,
      params.vehicleType,
    );
    if (!vResult.found) continue;

    // Can the drone get there within range?
    const dResult = dijkstra(
      nodes,
      edges,
      params.droneBaseNodeId,
      node.nodeId,
      'drone',
    );
    if (!dResult.found) continue;
    if (dResult.totalTimeMinutes > params.droneMaxMinutes) continue;

    candidates.push({
      nodeId: node.nodeId,
      displayName: node.displayName,
      lat: node.lat,
      lng: node.lng,
      vehicleTimeMinutes: Math.round(vResult.totalTimeMinutes * 10) / 10,
      droneTimeMinutes: Math.round(dResult.totalTimeMinutes * 10) / 10,
      meetTimeMinutes:
        Math.round(
          Math.max(vResult.totalTimeMinutes, dResult.totalTimeMinutes) * 10,
        ) / 10,
    });
  }

  if (candidates.length === 0) {
    return {
      ...base,
      best: null,
      allCandidates: [],
      constraintViolation:
        'No valid rendezvous nodes within drone range and vehicle reach',
    };
  }

  // Optimal = minimise max(vehicleTime, droneTime) — agents arrive simultaneously
  const sorted = [...candidates].sort(
    (a, b) => a.meetTimeMinutes - b.meetTimeMinutes,
  );

  return {
    ...base,
    best: sorted[0]!,
    allCandidates: sorted,
    constraintViolation: null,
  };
}

// ─── M8.4 Battery-Aware Broadcast Throttling ─────────────────────────────────

export function computeBroadcastInterval(
  batteryPct: number,
  isStationary: boolean,
  nearbyNodes: number,
): { intervalMs: number; reductionPct: number; reason: string } {
  const reasons: string[] = [];
  let multiplier = 1;

  if (batteryPct < 30) {
    multiplier *= 2.5; // 60% fewer broadcasts (keep 40%)
    reasons.push(`battery ${batteryPct.toFixed(0)}%<30% → ×2.5`);
  }

  if (isStationary) {
    multiplier *= 5; // 80% fewer broadcasts (keep 20%)
    reasons.push('stationary → ×5');
  }

  if (nearbyNodes >= 3) {
    multiplier *= 1.5; // proximity to coordinated nodes reduces need
    reasons.push(`${nearbyNodes} nearby nodes → ×1.5`);
  }

  const intervalMs = Math.round(BASE_BROADCAST_INTERVAL_MS * multiplier);
  // reductionPct = how much LESS frequently we broadcast vs base
  const reductionPct = Math.round((1 - 1 / multiplier) * 100);

  return {
    intervalMs,
    reductionPct,
    reason: reasons.length > 0 ? reasons.join('; ') : 'nominal',
  };
}

/**
 * Simulate a 10-minute mesh broadcast session with changing conditions.
 * Returns per-minute throttle decisions and aggregate savings.
 */
export function simulateBatteryThrottling(): ThrottleSimResult {
  const SIM_DURATION_MS = 10 * 60 * 1_000;
  const SAMPLE_MS = 60 * 1_000; // 1 sample per minute

  const entries: ThrottleEntry[] = [];
  let actualBroadcasts = 0;
  let baselineBroadcasts = 0;

  for (let t = 0; t <= SIM_DURATION_MS; t += SAMPLE_MS) {
    const min = t / 60_000;

    // Simulate conditions degrading over time:
    // - Battery drains ~8 %/min starting at 100 %
    // - Device stops moving at 6 min (flood scenario — boat grounded)
    // - Enters a node-dense area at 7 min
    const batteryPct = Math.max(15, 100 - min * 8);
    const isStationary = min >= 6;
    const nearbyNodes = min >= 7 ? 3 : 0;

    const { intervalMs, reductionPct, reason } = computeBroadcastInterval(
      batteryPct,
      isStationary,
      nearbyNodes,
    );

    // Count broadcasts in this 1-min window
    const windowMs = SAMPLE_MS;
    baselineBroadcasts += Math.floor(windowMs / BASE_BROADCAST_INTERVAL_MS);
    actualBroadcasts += Math.floor(windowMs / intervalMs);

    entries.push({
      timeMinutes: min,
      batteryPct: Math.round(batteryPct),
      isStationary,
      nearbyNodes,
      broadcastIntervalMs: intervalMs,
      reductionPct,
      reason,
    });
  }

  const savedBroadcasts = baselineBroadcasts - actualBroadcasts;
  const savedPct =
    baselineBroadcasts > 0
      ? Math.round((savedBroadcasts / baselineBroadcasts) * 100)
      : 0;

  return {
    entries,
    baselineBroadcasts,
    actualBroadcasts,
    savedBroadcasts,
    savedPct,
  };
}
