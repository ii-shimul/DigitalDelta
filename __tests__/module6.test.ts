import type { PriorityTier, TriageDecisionDto } from '../src/core/contracts';
import {
  DEFAULT_SLA_POLICY_MINUTES,
  calculateSlowdownPercent,
  groupCargoIdsByPriority,
  predictCargoSlaBreaches,
  selectDroppableCargoIds,
} from '../src/core/triage/engine';
import {
  decodeTriageDecision,
  encodeTriageDecision,
} from '../src/core/triage/protocol';

test('module6: priority taxonomy defines required SLA windows', () => {
  expect(DEFAULT_SLA_POLICY_MINUTES.P0).toBe(120);
  expect(DEFAULT_SLA_POLICY_MINUTES.P1).toBe(360);
  expect(DEFAULT_SLA_POLICY_MINUTES.P2).toBe(1440);
  expect(DEFAULT_SLA_POLICY_MINUTES.P3).toBe(4320);
});

test('module6: slowdown prediction crosses 30 percent threshold', () => {
  const slowedByPercent = calculateSlowdownPercent(100, 135);
  expect(slowedByPercent).toBeGreaterThanOrEqual(30);
  expect(slowedByPercent).toBeCloseTo(35, 2);
});

test('module6: SLA breach prediction flags P0 cargo under degraded route ETA', () => {
  const nowMs = Date.now();
  const predictions = predictCargoSlaBreaches({
    nowMs,
    currentEtaMinutes: 200,
    cargoItems: [
      {
        cargoId: 'CRG-P0',
        priorityTier: 'P0',
        slaDeadlineMs: nowMs + 120 * 60_000,
        dropAllowed: false,
        weightGrams: 1200,
        status: 'loaded',
      },
      {
        cargoId: 'CRG-P2',
        priorityTier: 'P2',
        slaDeadlineMs: nowMs + 24 * 60 * 60_000,
        dropAllowed: true,
        weightGrams: 5000,
        status: 'loaded',
      },
    ],
  });

  const p0 = predictions.find(item => item.cargoId === 'CRG-P0');
  const p2 = predictions.find(item => item.cargoId === 'CRG-P2');

  expect(p0?.breached).toBe(true);
  expect(p2?.breached).toBe(false);
});

test('module6: preemption candidate includes only droppable P2/P3 cargo', () => {
  const cargoItems = [
    {
      cargoId: 'CRG-001',
      priorityTier: 'P0' as PriorityTier,
      slaDeadlineMs: 1,
      dropAllowed: false,
      weightGrams: 1,
      status: 'loaded',
    },
    {
      cargoId: 'CRG-002',
      priorityTier: 'P2' as PriorityTier,
      slaDeadlineMs: 1,
      dropAllowed: true,
      weightGrams: 1,
      status: 'loaded',
    },
    {
      cargoId: 'CRG-003',
      priorityTier: 'P3' as PriorityTier,
      slaDeadlineMs: 1,
      dropAllowed: true,
      weightGrams: 1,
      status: 'loaded',
    },
    {
      cargoId: 'CRG-004',
      priorityTier: 'P3' as PriorityTier,
      slaDeadlineMs: 1,
      dropAllowed: false,
      weightGrams: 1,
      status: 'loaded',
    },
  ];

  const grouped = groupCargoIdsByPriority(cargoItems);
  const droppable = selectDroppableCargoIds({ cargoItems });

  expect(grouped.P0).toEqual(['CRG-001']);
  expect(grouped.P2).toEqual(['CRG-002']);
  expect(grouped.P3).toEqual(['CRG-003', 'CRG-004']);
  expect(droppable).toEqual(['CRG-002', 'CRG-003']);
});

test('module6: triage decision protobuf round-trip keeps drop-and-reroute details', () => {
  const decision: TriageDecisionDto = {
    decisionId: 'TRI-UNIT-001',
    deliveryId: 'DLV-004',
    highestRemainingPriority: 'P1',
    preempted: true,
    droppedCargoIds: ['CRG-004', 'CRG-005'],
    safeWaypointNodeId: 'N3',
    rationale: 'Dropped P2/P3 cargo at waypoint N3 and rerouted with P0/P1 only.',
    decidedAtMs: Date.now(),
  };

  const decoded = decodeTriageDecision(encodeTriageDecision(decision));

  expect(decoded.preempted).toBe(true);
  expect(decoded.highestRemainingPriority).toBe('P1');
  expect(decoded.droppedCargoIds).toEqual(['CRG-004', 'CRG-005']);
  expect(decoded.safeWaypointNodeId).toBe('N3');
});
