import type { PriorityTier, RouteMode } from '../contracts';

export type FleetEdgeStatus =
  | 'open'
  | 'degraded'
  | 'washed_out'
  | 'impassable'
  | 'high_risk';

export type FleetEdgeType = 'road' | 'waterway' | 'airway';

export type FleetGraphNode = {
  nodeId: string;
  latitude: number;
  longitude: number;
};

export type FleetGraphEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: FleetEdgeType;
  status: FleetEdgeStatus;
  travelTimeMinutes: number;
  riskScore: number;
};

export type FleetModeReachability = {
  mode: RouteMode;
  reachable: boolean;
  etaMinutes?: number;
};

export type DroneRequiredZoneResult = {
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  reachableByTruck: boolean;
  reachableBySpeedboat: boolean;
  reachableByDrone: boolean;
  droneRequired: boolean;
  reason: string;
};

export type RendezvousPlanResult = {
  feasible: boolean;
  rendezvousNodeId?: string;
  rendezvousLatitude?: number;
  rendezvousLongitude?: number;
  boatEtaMinutes?: number;
  droneEtaToRendezvousMinutes?: number;
  droneEtaToDestinationMinutes?: number;
  totalEtaMinutes?: number;
  reason?: string;
};

const BLOCKED_EDGE_STATUSES = new Set<FleetEdgeStatus>([
  'washed_out',
  'impassable',
]);

const EDGE_TYPE_BY_MODE: Record<RouteMode, FleetEdgeType> = {
  truck: 'road',
  speedboat: 'waterway',
  drone: 'airway',
};

export function evaluateDroneRequiredZone(input: {
  deliveryId: string;
  originNodeId: string;
  destinationNodeId: string;
  edges: FleetGraphEdge[];
}): DroneRequiredZoneResult {
  const truckEta = shortestPathMinutes({
    originNodeId: input.originNodeId,
    destinationNodeId: input.destinationNodeId,
    edgeType: 'road',
    edges: input.edges,
  });
  const speedboatEta = shortestPathMinutes({
    originNodeId: input.originNodeId,
    destinationNodeId: input.destinationNodeId,
    edgeType: 'waterway',
    edges: input.edges,
  });
  const droneEta = shortestPathMinutes({
    originNodeId: input.originNodeId,
    destinationNodeId: input.destinationNodeId,
    edgeType: 'airway',
    edges: input.edges,
  });

  const reachableByTruck = Number.isFinite(truckEta);
  const reachableBySpeedboat = Number.isFinite(speedboatEta);
  const reachableByDrone = Number.isFinite(droneEta);
  const droneRequired = !reachableByTruck && !reachableBySpeedboat && reachableByDrone;

  const reason = droneRequired
    ? 'Destination unreachable by truck/speedboat under current graph state; drone route available.'
    : reachableByTruck || reachableBySpeedboat
      ? 'Ground or water route remains feasible.'
      : 'No feasible route found for truck, speedboat, or drone.';

  return {
    deliveryId: input.deliveryId,
    originNodeId: input.originNodeId,
    destinationNodeId: input.destinationNodeId,
    reachableByTruck,
    reachableBySpeedboat,
    reachableByDrone,
    droneRequired,
    reason,
  };
}

export function computeOptimalRendezvous(input: {
  nodes: FleetGraphNode[];
  edges: FleetGraphEdge[];
  boatStartNodeId: string;
  droneStartNodeId: string;
  destinationNodeId: string;
  droneRangeKm: number;
  payloadWeightGrams: number;
  dronePayloadLimitGrams: number;
}): RendezvousPlanResult {
  if (input.payloadWeightGrams > input.dronePayloadLimitGrams) {
    return {
      feasible: false,
      reason: `Payload ${input.payloadWeightGrams}g exceeds drone limit ${input.dronePayloadLimitGrams}g.`,
    };
  }

  const nodeMap = new Map(input.nodes.map(node => [node.nodeId, node]));
  const destinationNode = nodeMap.get(input.destinationNodeId);
  const droneStartNode = nodeMap.get(input.droneStartNodeId);
  if (!destinationNode || !droneStartNode) {
    return {
      feasible: false,
      reason: 'Destination or drone origin node is missing.',
    };
  }

  let best:
    | {
        nodeId: string;
        latitude: number;
        longitude: number;
        boatEtaMinutes: number;
        droneEtaToRendezvousMinutes: number;
        droneEtaToDestinationMinutes: number;
        totalEtaMinutes: number;
      }
    | undefined;

  for (const candidate of input.nodes) {
    const boatEtaMinutes = shortestPathMinutes({
      originNodeId: input.boatStartNodeId,
      destinationNodeId: candidate.nodeId,
      edgeType: 'waterway',
      edges: input.edges,
    });
    if (!Number.isFinite(boatEtaMinutes)) {
      continue;
    }

    const droneEtaToRendezvousMinutes = shortestPathMinutes({
      originNodeId: input.droneStartNodeId,
      destinationNodeId: candidate.nodeId,
      edgeType: 'airway',
      edges: input.edges,
    });
    if (!Number.isFinite(droneEtaToRendezvousMinutes)) {
      continue;
    }

    const droneEtaToDestinationMinutes = shortestPathMinutes({
      originNodeId: candidate.nodeId,
      destinationNodeId: input.destinationNodeId,
      edgeType: 'airway',
      edges: input.edges,
    });
    if (!Number.isFinite(droneEtaToDestinationMinutes)) {
      continue;
    }

    const candidateRangeKm =
      haversineKilometers(droneStartNode, candidate) +
      haversineKilometers(candidate, destinationNode);
    if (candidateRangeKm > input.droneRangeKm) {
      continue;
    }

    const totalEtaMinutes =
      boatEtaMinutes + droneEtaToRendezvousMinutes + droneEtaToDestinationMinutes;

    if (!best || totalEtaMinutes < best.totalEtaMinutes) {
      best = {
        nodeId: candidate.nodeId,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        boatEtaMinutes,
        droneEtaToRendezvousMinutes,
        droneEtaToDestinationMinutes,
        totalEtaMinutes,
      };
    }
  }

  if (!best) {
    return {
      feasible: false,
      reason:
        'No rendezvous node satisfies boat/drone reachability, drone range, and payload constraints.',
    };
  }

  return {
    feasible: true,
    rendezvousNodeId: best.nodeId,
    rendezvousLatitude: best.latitude,
    rendezvousLongitude: best.longitude,
    boatEtaMinutes: best.boatEtaMinutes,
    droneEtaToRendezvousMinutes: best.droneEtaToRendezvousMinutes,
    droneEtaToDestinationMinutes: best.droneEtaToDestinationMinutes,
    totalEtaMinutes: best.totalEtaMinutes,
  };
}

export function shortestPathMinutes(input: {
  originNodeId: string;
  destinationNodeId: string;
  edgeType: FleetEdgeType;
  edges: FleetGraphEdge[];
}): number {
  if (input.originNodeId === input.destinationNodeId) {
    return 0;
  }

  const outgoing = new Map<string, FleetGraphEdge[]>();
  const nodes = new Set<string>([input.originNodeId, input.destinationNodeId]);

  for (const edge of input.edges) {
    if (edge.edgeType !== input.edgeType) {
      continue;
    }

    if (BLOCKED_EDGE_STATUSES.has(edge.status)) {
      continue;
    }

    const list = outgoing.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.sourceNodeId, list);
    nodes.add(edge.sourceNodeId);
    nodes.add(edge.targetNodeId);
  }

  if (!nodes.has(input.originNodeId) || !nodes.has(input.destinationNodeId)) {
    return Number.POSITIVE_INFINITY;
  }

  const distances = new Map<string, number>();
  const unvisited = new Set<string>();

  for (const nodeId of nodes) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    unvisited.add(nodeId);
  }
  distances.set(input.originNodeId, 0);

  while (unvisited.size > 0) {
    let currentNodeId: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (distance < bestDistance) {
        bestDistance = distance;
        currentNodeId = nodeId;
      }
    }

    if (!currentNodeId || !Number.isFinite(bestDistance)) {
      break;
    }

    unvisited.delete(currentNodeId);
    if (currentNodeId === input.destinationNodeId) {
      return bestDistance;
    }

    const neighbors = outgoing.get(currentNodeId) ?? [];
    for (const edge of neighbors) {
      if (!unvisited.has(edge.targetNodeId)) {
        continue;
      }

      const nextDistance = bestDistance + Math.max(1, edge.travelTimeMinutes);
      if (nextDistance < (distances.get(edge.targetNodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.targetNodeId, nextDistance);
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function haversineKilometers(
  left: Pick<FleetGraphNode, 'latitude' | 'longitude'>,
  right: Pick<FleetGraphNode, 'latitude' | 'longitude'>,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;

  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(toRadians(left.latitude)) *
      Math.cos(toRadians(right.latitude)) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  const angular = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * angular;
}
