import { Enum, Field, Root, Type, type Message } from 'protobufjs';

import type { PriorityTier, TriageDecisionDto } from '../contracts';

const root = new Root();

const PriorityTierEnum = new Enum('PriorityTier', {
  PRIORITY_TIER_UNSPECIFIED: 0,
  PRIORITY_TIER_P0_CRITICAL: 1,
  PRIORITY_TIER_P1_HIGH: 2,
  PRIORITY_TIER_P2_STANDARD: 3,
  PRIORITY_TIER_P3_LOW: 4,
});

const TriageDecisionMessage = new Type('TriageDecision')
  .add(new Field('decision_id', 1, 'string'))
  .add(new Field('delivery_id', 2, 'string'))
  .add(new Field('highest_remaining_priority', 3, 'PriorityTier'))
  .add(new Field('preempted', 4, 'bool'))
  .add(new Field('dropped_cargo_ids', 5, 'string', 'repeated'))
  .add(new Field('safe_waypoint_node_id', 6, 'string'))
  .add(new Field('rationale', 7, 'string'))
  .add(new Field('decided_at_ms', 8, 'uint64'));

root.define('digitaldelta.v1').add(PriorityTierEnum).add(TriageDecisionMessage);

const tierToProto: Record<PriorityTier, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
};

const tierFromProto: Record<number, PriorityTier> = {
  1: 'P0',
  2: 'P1',
  3: 'P2',
  4: 'P3',
};

export function encodeTriageDecision(decision: TriageDecisionDto): Uint8Array {
  const encoded = TriageDecisionMessage.encode(
    TriageDecisionMessage.create({
      decision_id: decision.decisionId,
      delivery_id: decision.deliveryId,
      highest_remaining_priority: tierToProto[decision.highestRemainingPriority],
      preempted: decision.preempted,
      dropped_cargo_ids: decision.droppedCargoIds,
      safe_waypoint_node_id: decision.safeWaypointNodeId,
      rationale: decision.rationale,
      decided_at_ms: decision.decidedAtMs,
    }),
  ).finish();

  return new Uint8Array(encoded);
}

export function decodeTriageDecision(encoded: Uint8Array): TriageDecisionDto {
  const decoded = TriageDecisionMessage.decode(encoded) as Message<{
    decision_id?: string;
    delivery_id?: string;
    highest_remaining_priority?: number | string;
    preempted?: boolean;
    dropped_cargo_ids?: string[];
    safe_waypoint_node_id?: string;
    rationale?: string;
    decided_at_ms?: unknown;
  }>;

  const plain = TriageDecisionMessage.toObject(decoded, {
    longs: Number,
    defaults: false,
  }) as Record<string, unknown>;

  const tierId =
    typeof plain.highest_remaining_priority === 'number'
      ? plain.highest_remaining_priority
      : Number(plain.highest_remaining_priority ?? 0) || 0;

  return {
    decisionId: asString(plain.decision_id),
    deliveryId: asString(plain.delivery_id),
    highestRemainingPriority: tierFromProto[tierId] ?? 'P3',
    preempted: Boolean(plain.preempted),
    droppedCargoIds: Array.isArray(plain.dropped_cargo_ids)
      ? plain.dropped_cargo_ids.filter((item): item is string => typeof item === 'string')
      : [],
    safeWaypointNodeId: asOptionalString(plain.safe_waypoint_node_id),
    rationale: asString(plain.rationale),
    decidedAtMs: asNumber(plain.decided_at_ms),
  };
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
