import {
  computeRouteFromGraph,
  type RoutingGraphEdge,
} from '../src/core/routing/engine';

test('module4: truck routing only uses road edges', () => {
  const edges: RoutingGraphEdge[] = [
    {
      edgeId: 'E1',
      sourceNodeId: 'N1',
      targetNodeId: 'N2',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 12,
      capacityUnits: 100,
      riskScore: 0.2,
    },
    {
      edgeId: 'E2',
      sourceNodeId: 'N2',
      targetNodeId: 'N4',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 18,
      capacityUnits: 100,
      riskScore: 0.25,
    },
    {
      edgeId: 'E3',
      sourceNodeId: 'N1',
      targetNodeId: 'N4',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 7,
      capacityUnits: 200,
      riskScore: 0.1,
    },
  ];

  const route = computeRouteFromGraph({
    routeId: 'RTE-TRUCK-01',
    deliveryId: 'DLV-TRUCK-01',
    vehicleId: 'VEH-TRUCK-01',
    vehicleType: 'truck',
    originNodeId: 'N1',
    destinationNodeId: 'N4',
    edges,
  });

  expect(route.requiresHandoff).toBe(false);
  expect(route.legs.map(leg => leg.edgeId)).toEqual(['E1', 'E2']);
  expect(route.legs.every(leg => leg.edgeType === 'road')).toBe(true);
});

test('module4: recomputes route under 2s after road failure', () => {
  const baseEdges: RoutingGraphEdge[] = [
    {
      edgeId: 'E1',
      sourceNodeId: 'N1',
      targetNodeId: 'N2',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 10,
      capacityUnits: 120,
      riskScore: 0.12,
    },
    {
      edgeId: 'E2',
      sourceNodeId: 'N2',
      targetNodeId: 'N4',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 10,
      capacityUnits: 120,
      riskScore: 0.15,
    },
    {
      edgeId: 'E3',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 16,
      capacityUnits: 120,
      riskScore: 0.16,
    },
    {
      edgeId: 'E4',
      sourceNodeId: 'N3',
      targetNodeId: 'N4',
      edgeType: 'road',
      status: 'open',
      travelTimeMinutes: 16,
      capacityUnits: 120,
      riskScore: 0.18,
    },
  ];

  const primary = computeRouteFromGraph({
    routeId: 'RTE-FAIL-01',
    deliveryId: 'DLV-FAIL-01',
    vehicleId: 'VEH-TRUCK-01',
    vehicleType: 'truck',
    originNodeId: 'N1',
    destinationNodeId: 'N4',
    edges: baseEdges,
  });
  expect(primary.legs.map(leg => leg.edgeId)).toEqual(['E1', 'E2']);

  const failedEdges = baseEdges.map(edge =>
    edge.edgeId === 'E2' ? { ...edge, status: 'washed_out' as const } : edge,
  );

  const startedAtMs = Date.now();
  const recomputed = computeRouteFromGraph({
    routeId: 'RTE-FAIL-01',
    deliveryId: 'DLV-FAIL-01',
    vehicleId: 'VEH-TRUCK-01',
    vehicleType: 'truck',
    originNodeId: 'N1',
    destinationNodeId: 'N4',
    edges: failedEdges,
  });
  const durationMs = Date.now() - startedAtMs;

  expect(durationMs).toBeLessThan(2000);
  expect(recomputed.legs.map(leg => leg.edgeId)).toEqual(['E3', 'E4']);
  expect(recomputed.blockedEdgeIds).toContain('E2');
});

test('module4: speedboat route triggers handoff when destination is airway-only', () => {
  const edges: RoutingGraphEdge[] = [
    {
      edgeId: 'E1',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 30,
      capacityUnits: 160,
      riskScore: 0.2,
    },
    {
      edgeId: 'E2',
      sourceNodeId: 'N3',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 12,
      capacityUnits: 20,
      riskScore: 0.1,
    },
  ];

  const route = computeRouteFromGraph({
    routeId: 'RTE-HANDOFF-01',
    deliveryId: 'DLV-HANDOFF-01',
    vehicleId: 'VEH-BOAT-01',
    vehicleType: 'speedboat',
    originNodeId: 'N1',
    destinationNodeId: 'N7',
    edges,
  });

  expect(route.requiresHandoff).toBe(true);
  expect(route.handoffNodeIds).toEqual(['N3']);
  expect(route.handoffTargetMode).toBe('drone');
  expect(route.legs.map(leg => leg.edgeType)).toEqual(['waterway']);
  expect(route.secondaryLegs.map(leg => leg.edgeType)).toEqual(['airway']);
});

test('module4: drone route enforces payload weight limit', () => {
  const edges: RoutingGraphEdge[] = [
    {
      edgeId: 'E1',
      sourceNodeId: 'N6',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 14,
      capacityUnits: 10,
      riskScore: 0.14,
    },
  ];

  expect(() =>
    computeRouteFromGraph({
      routeId: 'RTE-DRONE-01',
      deliveryId: 'DLV-DRONE-01',
      vehicleId: 'VEH-DRONE-01',
      vehicleType: 'drone',
      originNodeId: 'N6',
      destinationNodeId: 'N7',
      edges,
      payloadWeightGrams: 16_000,
      payloadLimitGrams: 15_000,
    }),
  ).toThrow('exceeds drone limit');
});
