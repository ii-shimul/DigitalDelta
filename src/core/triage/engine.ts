import type { PriorityTier } from '../contracts';

export type SlaPolicyMinutes = Record<PriorityTier, number>;

export const DEFAULT_SLA_POLICY_MINUTES: SlaPolicyMinutes = {
  P0: 120,
  P1: 360,
  P2: 1_440,
  P3: 4_320,
};

export type CargoSlaSnapshot = {
  cargoId: string;
  priorityTier: PriorityTier;
  slaDeadlineMs: number;
  dropAllowed: boolean;
  weightGrams: number;
  status: string;
};

export type CargoBreachPrediction = {
  cargoId: string;
  priorityTier: PriorityTier;
  breached: boolean;
  minutesUntilDeadline: number;
  projectedArrivalMs: number;
};

export function calculateSlowdownPercent(
  baselineEtaMinutes: number,
  currentEtaMinutes: number,
): number {
  if (baselineEtaMinutes <= 0 || !Number.isFinite(baselineEtaMinutes)) {
    return 0;
  }

  const slowdown = ((currentEtaMinutes - baselineEtaMinutes) / baselineEtaMinutes) * 100;
  return Number.isFinite(slowdown) ? Math.max(0, slowdown) : 0;
}

export function getSlaWindowMinutes(tier: PriorityTier): number {
  return DEFAULT_SLA_POLICY_MINUTES[tier];
}

export function predictCargoSlaBreaches(input: {
  cargoItems: CargoSlaSnapshot[];
  nowMs: number;
  currentEtaMinutes: number;
}): CargoBreachPrediction[] {
  const projectedArrivalMs = input.nowMs + input.currentEtaMinutes * 60_000;

  return input.cargoItems.map(item => {
    const minutesUntilDeadline = Math.floor((item.slaDeadlineMs - input.nowMs) / 60_000);

    return {
      cargoId: item.cargoId,
      priorityTier: item.priorityTier,
      breached: projectedArrivalMs > item.slaDeadlineMs,
      minutesUntilDeadline,
      projectedArrivalMs,
    };
  });
}

export function groupCargoIdsByPriority(
  cargoItems: Array<Pick<CargoSlaSnapshot, 'cargoId' | 'priorityTier'>>,
): Record<PriorityTier, string[]> {
  const grouped: Record<PriorityTier, string[]> = {
    P0: [],
    P1: [],
    P2: [],
    P3: [],
  };

  for (const cargo of cargoItems) {
    grouped[cargo.priorityTier].push(cargo.cargoId);
  }

  return grouped;
}

export function selectDroppableCargoIds(input: {
  cargoItems: CargoSlaSnapshot[];
  includeTiers?: PriorityTier[];
}): string[] {
  const allowedTiers = new Set(input.includeTiers ?? ['P2', 'P3']);

  return input.cargoItems
    .filter(item => allowedTiers.has(item.priorityTier) && item.dropAllowed)
    .map(item => item.cargoId);
}

export function highestPriorityTier(
  tiers: PriorityTier[],
): PriorityTier {
  if (tiers.includes('P0')) {
    return 'P0';
  }

  if (tiers.includes('P1')) {
    return 'P1';
  }

  if (tiers.includes('P2')) {
    return 'P2';
  }

  return 'P3';
}
