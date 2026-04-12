// Multi-Modal VRP Routing Engine — Dijkstra with vehicle-type constraints

export type EdgeType = 'road' | 'waterway' | 'airway';
export type VehicleType = 'truck' | 'speedboat' | 'drone';
export type EdgeStatus = 'clear' | 'flooded' | 'impassable' | 'high_risk';

export const VEHICLE_ALLOWED_EDGES: Record<VehicleType, EdgeType[]> = {
  truck: ['road'],
  speedboat: ['waterway'],
  drone: ['airway'],
};

export type GraphNode = {
  nodeId: string;
  displayName: string;
  nodeType: string; // 'depot' | 'hospital' | 'camp' | 'drone_base'
  lat: number;
  lng: number;
};

export type GraphEdge = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: EdgeType;
  status: EdgeStatus;
  travelTimeMinutes: number;
  capacityUnits: number;
  riskScore: number; // 0.0–1.0
};

export type RouteResult = {
  vehicleType: VehicleType;
  sourceNodeId: string;
  destNodeId: string;
  path: string[]; // node IDs in order
  edgeIds: string[];
  totalTimeMinutes: number;
  found: boolean;
  computedInMs: number;
};

/**
 * Effective weight for an edge given vehicle constraints and risk.
 * Returns Infinity if the edge is impassable or wrong type for vehicle.
 */
function effectiveWeight(edge: GraphEdge, vehicleType: VehicleType): number {
  const allowed = VEHICLE_ALLOWED_EDGES[vehicleType];
  if (!allowed.includes(edge.edgeType)) {
    return Infinity;
  }
  if (edge.status === 'flooded' || edge.status === 'impassable') {
    return Infinity;
  }
  // High-risk edges (from M7 predictions) have penalized weight
  const riskPenalty = edge.status === 'high_risk' ? 1 + edge.riskScore * 2 : 1;
  return edge.travelTimeMinutes * riskPenalty;
}

/**
 * Dijkstra shortest path with vehicle-type edge filtering.
 */
export function dijkstra(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sourceId: string,
  destId: string,
  vehicleType: VehicleType,
): RouteResult {
  const startMs = Date.now();

  // Build adjacency list: nodeId -> [{edgeId, targetId, weight}]
  type AdjEntry = { edgeId: string; targetId: string; weight: number };
  const adj = new Map<string, AdjEntry[]>();
  for (const n of nodes) {
    adj.set(n.nodeId, []);
  }
  for (const e of edges) {
    const w = effectiveWeight(e, vehicleType);
    if (w < Infinity) {
      adj
        .get(e.sourceNodeId)
        ?.push({ edgeId: e.edgeId, targetId: e.targetNodeId, weight: w });
      // Treat as bidirectional (roads/rivers can be travelled both ways)
      adj
        .get(e.targetNodeId)
        ?.push({ edgeId: e.edgeId, targetId: e.sourceNodeId, weight: w });
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edgeId: string } | null>();
  const visited = new Set<string>();

  for (const n of nodes) {
    dist.set(n.nodeId, Infinity);
    prev.set(n.nodeId, null);
  }
  dist.set(sourceId, 0);

  // Simple priority queue via sorted array (graph is tiny — max ~10 nodes)
  const queue: { nodeId: string; dist: number }[] = [
    { nodeId: sourceId, dist: 0 },
  ];

  while (queue.length > 0) {
    queue.sort((a, b) => a.dist - b.dist);
    const current = queue.shift()!;
    if (visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);

    if (current.nodeId === destId) {
      break;
    }

    for (const adj_entry of adj.get(current.nodeId) ?? []) {
      const newDist = (dist.get(current.nodeId) ?? Infinity) + adj_entry.weight;
      if (newDist < (dist.get(adj_entry.targetId) ?? Infinity)) {
        dist.set(adj_entry.targetId, newDist);
        prev.set(adj_entry.targetId, {
          nodeId: current.nodeId,
          edgeId: adj_entry.edgeId,
        });
        queue.push({ nodeId: adj_entry.targetId, dist: newDist });
      }
    }
  }

  const computedInMs = Date.now() - startMs;
  const totalTime = dist.get(destId) ?? Infinity;

  if (totalTime === Infinity) {
    return {
      vehicleType,
      sourceNodeId: sourceId,
      destNodeId: destId,
      path: [],
      edgeIds: [],
      totalTimeMinutes: Infinity,
      found: false,
      computedInMs,
    };
  }

  // Reconstruct path
  const path: string[] = [];
  const edgeIds: string[] = [];
  let cursor: string | null = destId;
  while (cursor !== null) {
    path.unshift(cursor);
    const p = prev.get(cursor);
    if (p) {
      edgeIds.unshift(p.edgeId);
      cursor = p.nodeId;
    } else {
      cursor = null;
    }
  }

  return {
    vehicleType,
    sourceNodeId: sourceId,
    destNodeId: destId,
    path,
    edgeIds,
    totalTimeMinutes: totalTime,
    found: true,
    computedInMs,
  };
}

// ─── Sylhet Map Data ─────────────────────────────────────────────────────────
// Nodes derived from the Sylhet Division scenario

export const SYLHET_NODES: GraphNode[] = [
  {
    nodeId: 'N1',
    displayName: 'Sylhet City HQ',
    nodeType: 'depot',
    lat: 24.899,
    lng: 91.872,
  },
  {
    nodeId: 'N2',
    displayName: 'Sunamganj Bridge',
    nodeType: 'camp',
    lat: 25.068,
    lng: 91.395,
  },
  {
    nodeId: 'N3',
    displayName: 'Netrokona Junction',
    nodeType: 'hospital',
    lat: 24.88,
    lng: 90.727,
  },
  {
    nodeId: 'N4',
    displayName: 'Mohanganj Camp',
    nodeType: 'camp',
    lat: 24.688,
    lng: 90.988,
  },
  {
    nodeId: 'N5',
    displayName: 'Habiganj Depot',
    nodeType: 'depot',
    lat: 24.374,
    lng: 91.415,
  },
  {
    nodeId: 'N6',
    displayName: 'Moulvibazar Post',
    nodeType: 'camp',
    lat: 24.483,
    lng: 91.779,
  },
  {
    nodeId: 'N7',
    displayName: 'Drone Base Alpha',
    nodeType: 'drone_base',
    lat: 24.899,
    lng: 91.872,
  },
];

export const SYLHET_EDGES: GraphEdge[] = [
  // Roads (trucks)
  {
    edgeId: 'E1',
    sourceNodeId: 'N1',
    targetNodeId: 'N2',
    edgeType: 'road',
    status: 'clear',
    travelTimeMinutes: 20,
    capacityUnits: 100,
    riskScore: 0.1,
  },
  {
    edgeId: 'E2',
    sourceNodeId: 'N1',
    targetNodeId: 'N3',
    edgeType: 'road',
    status: 'clear',
    travelTimeMinutes: 90,
    capacityUnits: 80,
    riskScore: 0.2,
  },
  {
    edgeId: 'E3',
    sourceNodeId: 'N2',
    targetNodeId: 'N4',
    edgeType: 'road',
    status: 'clear',
    travelTimeMinutes: 45,
    capacityUnits: 60,
    riskScore: 0.1,
  },
  {
    edgeId: 'E4',
    sourceNodeId: 'N1',
    targetNodeId: 'N5',
    edgeType: 'road',
    status: 'clear',
    travelTimeMinutes: 60,
    capacityUnits: 90,
    riskScore: 0.15,
  },
  {
    edgeId: 'E5',
    sourceNodeId: 'N1',
    targetNodeId: 'N6',
    edgeType: 'road',
    status: 'clear',
    travelTimeMinutes: 120,
    capacityUnits: 70,
    riskScore: 0.3,
  },
  // Waterways (speedboats)
  {
    edgeId: 'E6',
    sourceNodeId: 'N1',
    targetNodeId: 'N3',
    edgeType: 'waterway',
    status: 'clear',
    travelTimeMinutes: 150,
    capacityUnits: 40,
    riskScore: 0.2,
  },
  {
    edgeId: 'E7',
    sourceNodeId: 'N3',
    targetNodeId: 'N4',
    edgeType: 'waterway',
    status: 'clear',
    travelTimeMinutes: 50,
    capacityUnits: 35,
    riskScore: 0.1,
  },
  {
    edgeId: 'E8',
    sourceNodeId: 'N2',
    targetNodeId: 'N3',
    edgeType: 'waterway',
    status: 'clear',
    travelTimeMinutes: 80,
    capacityUnits: 40,
    riskScore: 0.15,
  },
  // Airways (drones)
  {
    edgeId: 'E9',
    sourceNodeId: 'N7',
    targetNodeId: 'N4',
    edgeType: 'airway',
    status: 'clear',
    travelTimeMinutes: 30,
    capacityUnits: 5,
    riskScore: 0.05,
  },
  {
    edgeId: 'E10',
    sourceNodeId: 'N7',
    targetNodeId: 'N5',
    edgeType: 'airway',
    status: 'clear',
    travelTimeMinutes: 40,
    capacityUnits: 5,
    riskScore: 0.05,
  },
  {
    edgeId: 'E11',
    sourceNodeId: 'N7',
    targetNodeId: 'N6',
    edgeType: 'airway',
    status: 'clear',
    travelTimeMinutes: 25,
    capacityUnits: 5,
    riskScore: 0.05,
  },
  {
    edgeId: 'E12',
    sourceNodeId: 'N7',
    targetNodeId: 'N2',
    edgeType: 'airway',
    status: 'clear',
    travelTimeMinutes: 20,
    capacityUnits: 5,
    riskScore: 0.05,
  },
];
