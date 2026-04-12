import {
  computeOptimalRendezvous,
  evaluateDroneRequiredZone,
  type FleetGraphEdge,
  type FleetGraphNode,
} from '../src/core/fleet/engine';
import {
  decodeFleetHandoffEvent,
  encodeFleetHandoffEvent,
} from '../src/core/fleet/protocol';
import { computeMeshThrottleSimulation } from '../src/core/fleet/mesh-throttle';

const sampleNodes: FleetGraphNode[] = [
  { nodeId: 'N1', latitude: 24.89, longitude: 91.86 },
  { nodeId: 'N3', latitude: 24.8562, longitude: 91.7408 },
  { nodeId: 'N4', latitude: 24.8836, longitude: 90.7279 },
  { nodeId: 'N6', latitude: 25.112, longitude: 91.924 },
  { nodeId: 'N7', latitude: 25.151, longitude: 92.05 },
];

test('module8: reachability marks drone-required zone when ground and water are blocked', () => {
  const edges: FleetGraphEdge[] = [
    {
      edgeId: 'R1',
      sourceNodeId: 'N1',
      targetNodeId: 'N7',
      edgeType: 'road',
      status: 'washed_out',
      travelTimeMinutes: 9_999,
      riskScore: 0.99,
    },
    {
      edgeId: 'W1',
      sourceNodeId: 'N1',
      targetNodeId: 'N7',
      edgeType: 'waterway',
      status: 'impassable',
      travelTimeMinutes: 9_999,
      riskScore: 0.99,
    },
    {
      edgeId: 'A1',
      sourceNodeId: 'N1',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 24,
      riskScore: 0.1,
    },
  ];

  const zone = evaluateDroneRequiredZone({
    deliveryId: 'DLV-DRONE-01',
    originNodeId: 'N1',
    destinationNodeId: 'N7',
    edges,
  });

  expect(zone.reachableByTruck).toBe(false);
  expect(zone.reachableBySpeedboat).toBe(false);
  expect(zone.reachableByDrone).toBe(true);
  expect(zone.droneRequired).toBe(true);
});

test('module8: rendezvous chooses node minimizing total dual-agent ETA', () => {
  const edges: FleetGraphEdge[] = [
    {
      edgeId: 'WB-1',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 40,
      riskScore: 0.2,
    },
    {
      edgeId: 'WB-2',
      sourceNodeId: 'N1',
      targetNodeId: 'N4',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 85,
      riskScore: 0.3,
    },
    {
      edgeId: 'DA-1',
      sourceNodeId: 'N6',
      targetNodeId: 'N3',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 14,
      riskScore: 0.12,
    },
    {
      edgeId: 'DA-2',
      sourceNodeId: 'N6',
      targetNodeId: 'N4',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 10,
      riskScore: 0.1,
    },
    {
      edgeId: 'DD-1',
      sourceNodeId: 'N3',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 12,
      riskScore: 0.1,
    },
    {
      edgeId: 'DD-2',
      sourceNodeId: 'N4',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 58,
      riskScore: 0.35,
    },
  ];

  const plan = computeOptimalRendezvous({
    nodes: sampleNodes,
    edges,
    boatStartNodeId: 'N1',
    droneStartNodeId: 'N6',
    destinationNodeId: 'N7',
    droneRangeKm: 120,
    payloadWeightGrams: 8_000,
    dronePayloadLimitGrams: 15_000,
  });

  expect(plan.feasible).toBe(true);
  expect(plan.rendezvousNodeId).toBe('N3');
  expect(plan.totalEtaMinutes).toBe(66);
});

test('module8: rendezvous fails when payload exceeds drone constraints', () => {
  const plan = computeOptimalRendezvous({
    nodes: sampleNodes,
    edges: [],
    boatStartNodeId: 'N1',
    droneStartNodeId: 'N6',
    destinationNodeId: 'N7',
    droneRangeKm: 120,
    payloadWeightGrams: 22_000,
    dronePayloadLimitGrams: 15_000,
  });

  expect(plan.feasible).toBe(false);
  expect(plan.reason).toContain('exceeds drone limit');
});

test('module8: rendezvous fails when range constraints are violated', () => {
  const edges: FleetGraphEdge[] = [
    {
      edgeId: 'WB-1',
      sourceNodeId: 'N1',
      targetNodeId: 'N3',
      edgeType: 'waterway',
      status: 'open',
      travelTimeMinutes: 20,
      riskScore: 0.1,
    },
    {
      edgeId: 'DA-1',
      sourceNodeId: 'N6',
      targetNodeId: 'N3',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 14,
      riskScore: 0.1,
    },
    {
      edgeId: 'DD-1',
      sourceNodeId: 'N3',
      targetNodeId: 'N7',
      edgeType: 'airway',
      status: 'open',
      travelTimeMinutes: 12,
      riskScore: 0.1,
    },
  ];

  const plan = computeOptimalRendezvous({
    nodes: sampleNodes,
    edges,
    boatStartNodeId: 'N1',
    droneStartNodeId: 'N6',
    destinationNodeId: 'N7',
    droneRangeKm: 5,
    payloadWeightGrams: 8_000,
    dronePayloadLimitGrams: 15_000,
  });

  expect(plan.feasible).toBe(false);
  expect(plan.reason).toContain('No rendezvous node');
});

test('module8: handoff protobuf preserves ownership-transfer payload details', () => {
  const wire = {
    handoffId: 'HND-008',
    deliveryId: 'DLV-004',
    sourceVehicleId: 'VEH-BOAT-01',
    sourceVehicleType: 'speedboat' as const,
    targetVehicleId: 'VEH-DRONE-01',
    targetVehicleType: 'drone' as const,
    rendezvousLatitude: 24.8562,
    rendezvousLongitude: 91.7408,
    cargoIds: ['CRG-004', 'CRG-005'],
    receiptId: 'pod-xyz',
    status: 'ownership_transferred' as const,
    occurredAtMs: Date.now(),
  };

  const roundTrip = decodeFleetHandoffEvent(encodeFleetHandoffEvent(wire));

  expect(roundTrip.handoffId).toBe(wire.handoffId);
  expect(roundTrip.deliveryId).toBe(wire.deliveryId);
  expect(roundTrip.sourceVehicleType).toBe('speedboat');
  expect(roundTrip.targetVehicleType).toBe('drone');
  expect(roundTrip.status).toBe('ownership_transferred');
  expect(roundTrip.cargoIds).toEqual(wire.cargoIds);
});

test('module8: mesh throttling simulation reports measurable 10-minute battery savings', () => {
  const simulation = computeMeshThrottleSimulation({
    durationMinutes: 10,
    baseBroadcastIntervalMs: 5_000,
    batteryPercent: 24,
    signalStrength: 74,
    nearbyPeerCount: 3,
    stationary: true,
    knownNodeDistanceMeters: 100,
    nearestNodeId: 'N3',
  });

  expect(simulation.reductionApplied.batteryLow).toBe(true);
  expect(simulation.reductionApplied.stationary).toBe(true);
  expect(simulation.reductionApplied.nearKnownNode).toBe(true);
  expect(simulation.baseline.broadcastCount).toBe(120);
  expect(simulation.throttled.broadcastCount).toBeLessThan(120);
  expect(simulation.batterySavedPercent).toBeGreaterThan(0);
});
