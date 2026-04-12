import type { RouteLegDto, RouteMode, RoutePlanDto } from '../contracts';

export type RouteEdgeStatus =
  | 'open'
  | 'degraded'
  | 'washed_out'
  | 'impassable'
  | 'high_risk';

export type RouteEdgeType = 'road' | 'waterway' | 'airway';

export type RoutingGraphEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: RouteEdgeType;
  status: RouteEdgeStatus;
  travelTimeMinutes: number;
  capacityUnits: number;
  riskScore: number;
};

export type ComputeRouteEngineInput = {
  routeId: string;
  deliveryId: string;
  vehicleId: string;
  vehicleType: RouteMode;
  originNodeId: string;
  destinationNodeId: string;
  edges: RoutingGraphEdge[];
  blockedEdgeIds?: string[];
  payloadWeightGrams?: number;
  payloadLimitGrams?: number;
  payloadUnits?: number;
};

export type ComputeRouteEngineResult = RoutePlanDto & {
  updateReason: string;
  predictedFailureProbability?: number;
  secondaryLegs: RouteLegDto[];
  handoffTargetMode?: RouteMode;
};

type PathSearchResult = {
  distancesByNode: Map<string, number>;
  previousEdgeByNode: Map<string, RoutingGraphEdge>;
};

type RoutePath = {
  edges: RoutingGraphEdge[];
  totalCost: number;
};

const UNUSABLE_EDGE_STATUSES = new Set<RouteEdgeStatus>([
  'washed_out',
  'impassable',
]);

const EDGE_TYPE_BY_VEHICLE: Record<RouteMode, RouteEdgeType> = {
  truck: 'road',
  speedboat: 'waterway',
  drone: 'airway',
};

const VEHICLE_BY_EDGE_TYPE: Record<RouteEdgeType, RouteMode> = {
  road: 'truck',
  waterway: 'speedboat',
  airway: 'drone',
};

const HANDOFF_TRANSFER_PENALTY_MINUTES = 10;

export function computeRouteFromGraph(
  input: ComputeRouteEngineInput,
): ComputeRouteEngineResult {
  validateDronePayload(input);

  const explicitBlocked = new Set(input.blockedEdgeIds ?? []);
  const blockedByStatus = input.edges
    .filter(edge => UNUSABLE_EDGE_STATUSES.has(edge.status))
    .map(edge => edge.edgeId);
  const blockedEdgeIds = Array.from(
    new Set([...explicitBlocked, ...blockedByStatus]),
  );

  const vehicleEdgeType = EDGE_TYPE_BY_VEHICLE[input.vehicleType];
  const payloadUnits = Math.max(0, input.payloadUnits ?? 0);

  const primarySearch = runDijkstra({
    edges: input.edges,
    originNodeId: input.originNodeId,
    edgeFilter: edge => {
      if (edge.edgeType !== vehicleEdgeType) {
        return false;
      }

      return !blockedEdgeIds.includes(edge.edgeId);
    },
    edgeCost: edge => scoreEdge(edge, payloadUnits),
  });

  const directPrimaryPath = buildPathToNode({
    destinationNodeId: input.destinationNodeId,
    previousEdgeByNode: primarySearch.previousEdgeByNode,
    distancesByNode: primarySearch.distancesByNode,
  });

  if (directPrimaryPath) {
    const legs = toRouteLegs(directPrimaryPath.edges, input.vehicleType);
    const totals = summarizePath(directPrimaryPath.edges);

    return {
      routeId: input.routeId,
      deliveryId: input.deliveryId,
      vehicleId: input.vehicleId,
      vehicleType: input.vehicleType,
      legs,
      totalEtaMinutes: totals.totalEtaMinutes,
      totalRiskScore: totals.totalRiskScore,
      blockedEdgeIds,
      handoffNodeIds: [],
      requiresHandoff: false,
      computedAtMs: Date.now(),
      updateReason: 'edge_status_changed',
      predictedFailureProbability: totals.maxRiskScore,
      secondaryLegs: [],
    };
  }

  const handoff = findBestHandoffPath({
    input,
    primarySearch,
    blockedEdgeIds,
    payloadUnits,
  });

  if (!handoff) {
    throw new Error(
      `No feasible ${input.vehicleType} route from ${input.originNodeId} to ${input.destinationNodeId}.`,
    );
  }

  const primaryLegs = toRouteLegs(handoff.primaryPath.edges, input.vehicleType);
  const secondaryEdgeType = handoff.secondaryPath.edges[0]?.edgeType;
  const handoffTargetMode = secondaryEdgeType
    ? VEHICLE_BY_EDGE_TYPE[secondaryEdgeType]
    : undefined;
  const secondaryLegs = handoffTargetMode
    ? toRouteLegs(handoff.secondaryPath.edges, handoffTargetMode)
    : [];
  const primaryTotals = summarizePath(handoff.primaryPath.edges);
  const secondaryTotals = summarizePath(handoff.secondaryPath.edges);

  return {
    routeId: input.routeId,
    deliveryId: input.deliveryId,
    vehicleId: input.vehicleId,
    vehicleType: input.vehicleType,
    legs: primaryLegs,
    totalEtaMinutes: primaryTotals.totalEtaMinutes,
    totalRiskScore: primaryTotals.totalRiskScore,
    blockedEdgeIds,
    handoffNodeIds: [handoff.handoffNodeId],
    requiresHandoff: true,
    computedAtMs: Date.now(),
    updateReason: 'handoff_required',
    predictedFailureProbability: Math.max(
      primaryTotals.maxRiskScore,
      secondaryTotals.maxRiskScore,
    ),
    secondaryLegs,
    handoffTargetMode,
  };
}

function findBestHandoffPath(input: {
  input: ComputeRouteEngineInput;
  primarySearch: PathSearchResult;
  blockedEdgeIds: string[];
  payloadUnits: number;
}):
  | {
      handoffNodeId: string;
      primaryPath: RoutePath;
      secondaryPath: RoutePath;
      totalCost: number;
    }
  | undefined {
  const vehicleEdgeType = EDGE_TYPE_BY_VEHICLE[input.input.vehicleType];

  let best:
    | {
        handoffNodeId: string;
        primaryPath: RoutePath;
        secondaryPath: RoutePath;
        totalCost: number;
      }
    | undefined;

  for (const candidateNodeId of input.primarySearch.distancesByNode.keys()) {
    const primaryPath = buildPathToNode({
      destinationNodeId: candidateNodeId,
      previousEdgeByNode: input.primarySearch.previousEdgeByNode,
      distancesByNode: input.primarySearch.distancesByNode,
    });

    if (!primaryPath || primaryPath.edges.length === 0) {
      continue;
    }

    const secondarySearch = runDijkstra({
      edges: input.input.edges,
      originNodeId: candidateNodeId,
      edgeFilter: edge => {
        if (edge.edgeType === vehicleEdgeType) {
          return false;
        }

        return !input.blockedEdgeIds.includes(edge.edgeId);
      },
      edgeCost: edge => scoreEdge(edge, input.payloadUnits),
    });

    const secondaryPath = buildPathToNode({
      destinationNodeId: input.input.destinationNodeId,
      previousEdgeByNode: secondarySearch.previousEdgeByNode,
      distancesByNode: secondarySearch.distancesByNode,
    });

    if (!secondaryPath || secondaryPath.edges.length === 0) {
      continue;
    }

    const totalCost =
      primaryPath.totalCost +
      secondaryPath.totalCost +
      HANDOFF_TRANSFER_PENALTY_MINUTES;

    if (!best || totalCost < best.totalCost) {
      best = {
        handoffNodeId: candidateNodeId,
        primaryPath,
        secondaryPath,
        totalCost,
      };
    }
  }

  return best;
}

function validateDronePayload(input: ComputeRouteEngineInput): void {
  if (input.vehicleType !== 'drone') {
    return;
  }

  if (
    typeof input.payloadLimitGrams === 'number' &&
    typeof input.payloadWeightGrams === 'number' &&
    input.payloadWeightGrams > input.payloadLimitGrams
  ) {
    throw new Error(
      `Payload ${input.payloadWeightGrams}g exceeds drone limit ${input.payloadLimitGrams}g.`,
    );
  }
}

function runDijkstra(input: {
  edges: RoutingGraphEdge[];
  originNodeId: string;
  edgeFilter: (edge: RoutingGraphEdge) => boolean;
  edgeCost: (edge: RoutingGraphEdge) => number;
}): PathSearchResult {
  const distancesByNode = new Map<string, number>();
  const previousEdgeByNode = new Map<string, RoutingGraphEdge>();
  const unvisited = new Set<string>();
  const outgoingByNode = new Map<string, RoutingGraphEdge[]>();

  for (const edge of input.edges) {
    if (!input.edgeFilter(edge)) {
      continue;
    }

    const outgoing = outgoingByNode.get(edge.sourceNodeId) ?? [];
    outgoing.push(edge);
    outgoingByNode.set(edge.sourceNodeId, outgoing);

    if (!distancesByNode.has(edge.sourceNodeId)) {
      distancesByNode.set(edge.sourceNodeId, Number.POSITIVE_INFINITY);
    }
    if (!distancesByNode.has(edge.targetNodeId)) {
      distancesByNode.set(edge.targetNodeId, Number.POSITIVE_INFINITY);
    }

    unvisited.add(edge.sourceNodeId);
    unvisited.add(edge.targetNodeId);
  }

  if (!distancesByNode.has(input.originNodeId)) {
    distancesByNode.set(input.originNodeId, 0);
    unvisited.add(input.originNodeId);
  } else {
    distancesByNode.set(input.originNodeId, 0);
  }

  while (unvisited.size > 0) {
    const nextNodeId = findNearestUnvisited(unvisited, distancesByNode);
    if (!nextNodeId) {
      break;
    }

    unvisited.delete(nextNodeId);
    const baseDistance = distancesByNode.get(nextNodeId);
    if (typeof baseDistance !== 'number' || !Number.isFinite(baseDistance)) {
      continue;
    }

    const outgoing = outgoingByNode.get(nextNodeId) ?? [];

    for (const edge of outgoing) {
      const edgeDistance = input.edgeCost(edge);
      const candidateDistance = baseDistance + edgeDistance;
      const existingDistance =
        distancesByNode.get(edge.targetNodeId) ?? Number.POSITIVE_INFINITY;

      if (candidateDistance < existingDistance) {
        distancesByNode.set(edge.targetNodeId, candidateDistance);
        previousEdgeByNode.set(edge.targetNodeId, edge);
      }
    }
  }

  return {
    distancesByNode,
    previousEdgeByNode,
  };
}

function buildPathToNode(input: {
  destinationNodeId: string;
  previousEdgeByNode: Map<string, RoutingGraphEdge>;
  distancesByNode: Map<string, number>;
}): RoutePath | undefined {
  const destinationDistance = input.distancesByNode.get(input.destinationNodeId);
  if (
    typeof destinationDistance !== 'number' ||
    !Number.isFinite(destinationDistance)
  ) {
    return undefined;
  }

  const reversed: RoutingGraphEdge[] = [];
  const seen = new Set<string>();
  let currentNodeId = input.destinationNodeId;

  while (true) {
    const edge = input.previousEdgeByNode.get(currentNodeId);
    if (!edge) {
      break;
    }

    const loopKey = `${edge.edgeId}:${currentNodeId}`;
    if (seen.has(loopKey)) {
      return undefined;
    }
    seen.add(loopKey);

    reversed.push(edge);
    currentNodeId = edge.sourceNodeId;
  }

  const edges = reversed.reverse();

  return {
    edges,
    totalCost: destinationDistance,
  };
}

function toRouteLegs(edges: RoutingGraphEdge[], vehicleType: RouteMode): RouteLegDto[] {
  return edges.map(edge => ({
    edgeId: edge.edgeId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    edgeType: edge.edgeType,
    vehicleType,
    etaMinutes: edge.travelTimeMinutes,
    riskScore: edge.riskScore,
  }));
}

function summarizePath(edges: RoutingGraphEdge[]): {
  totalEtaMinutes: number;
  totalRiskScore: number;
  maxRiskScore: number;
} {
  let totalEtaMinutes = 0;
  let totalRiskScore = 0;
  let maxRiskScore = 0;

  for (const edge of edges) {
    totalEtaMinutes += edge.travelTimeMinutes;
    totalRiskScore += edge.riskScore;
    maxRiskScore = Math.max(maxRiskScore, edge.riskScore);
  }

  return {
    totalEtaMinutes,
    totalRiskScore: Number(totalRiskScore.toFixed(3)),
    maxRiskScore: Number(maxRiskScore.toFixed(3)),
  };
}

function scoreEdge(edge: RoutingGraphEdge, payloadUnits: number): number {
  const riskPenalty = edge.riskScore * 24;
  const statusPenalty =
    edge.status === 'degraded' ? 6 : edge.status === 'high_risk' ? 16 : 0;

  const capacityPenalty =
    payloadUnits > 0 && edge.capacityUnits > 0 && edge.capacityUnits < payloadUnits
      ? (payloadUnits - edge.capacityUnits) * 1.6
      : 0;

  return edge.travelTimeMinutes + riskPenalty + statusPenalty + capacityPenalty;
}

function findNearestUnvisited(
  unvisited: Set<string>,
  distancesByNode: Map<string, number>,
): string | undefined {
  let bestNode: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const nodeId of unvisited) {
    const distance = distancesByNode.get(nodeId) ?? Number.POSITIVE_INFINITY;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = nodeId;
    }
  }

  return bestNode;
}
