// Core triage engine — priority tiers, SLA evaluation, drop-and-reroute decisions

export type CargoPriority = 'P0' | 'P1' | 'P2' | 'P3';

export const PRIORITY_META: Record<
  CargoPriority,
  { label: string; slaWindowMs: number; color: string; description: string }
> = {
  P0: {
    label: 'P0 – Critical Medical',
    slaWindowMs: 2 * 60 * 60 * 1000, // 2 hours
    color: '#e53e3e',
    description: 'Antivenom, O2, defibrillator – immediate life risk',
  },
  P1: {
    label: 'P1 – High',
    slaWindowMs: 6 * 60 * 60 * 1000, // 6 hours
    color: '#dd6b20',
    description: 'Surgical kits, blood supplies – urgent but not immediate',
  },
  P2: {
    label: 'P2 – Standard',
    slaWindowMs: 24 * 60 * 60 * 1000, // 24 hours
    color: '#d69e2e',
    description: 'Water purification, food rations, tents',
  },
  P3: {
    label: 'P3 – Low',
    slaWindowMs: 72 * 60 * 60 * 1000, // 72 hours
    color: '#38a169',
    description: 'Non-essential equipment, comfort supplies',
  },
};

export type CargoStatus =
  | 'active'
  | 'at_risk'
  | 'breached'
  | 'dropped'
  | 'delivered';

export type TriggerType = 'route_slowdown' | 'manual';
export type DecisionType = 'keep' | 'drop_to_waypoint' | 'reroute_priority';

export type SlaBreach = {
  cargoId: string;
  label: string;
  priority: CargoPriority;
  etaMs: number;
  deadlineMs: number;
  msUntilBreach: number;
  breached: boolean;
  atRisk: boolean; // will breach within 20% headroom
};

export type TriageDecision = {
  decisionId: string;
  cargoId: string;
  decisionType: DecisionType;
  priority: CargoPriority;
  rationale: string;
  waypoint?: string;
  decidedAtMs: number;
};

/**
 * Given a cargo item, compute whether its ETA (after applying slowdown) will breach SLA.
 */
export function evaluateSla(params: {
  cargoId: string;
  label: string;
  priority: CargoPriority;
  createdAtMs: number;
  etaMs: number;
  routeSlowdownPct: number; // e.g. 40 = 40% slower
}): SlaBreach {
  const { cargoId, label, priority, createdAtMs, etaMs, routeSlowdownPct } =
    params;
  const slaWindowMs = PRIORITY_META[priority].slaWindowMs;
  const deadlineMs = createdAtMs + slaWindowMs;

  // Apply the slowdown to get the adjusted ETA
  const slowdownMultiplier =
    routeSlowdownPct > 0 ? 1 + routeSlowdownPct / 100 : 1;
  const adjustedEtaMs = Date.now() + (etaMs - Date.now()) * slowdownMultiplier;

  const msUntilBreach = deadlineMs - adjustedEtaMs;
  const atRisk = msUntilBreach < slaWindowMs * 0.2; // <20% headroom = at risk
  const breached = adjustedEtaMs > deadlineMs;

  return {
    cargoId,
    label,
    priority,
    etaMs: adjustedEtaMs,
    deadlineMs,
    msUntilBreach,
    breached,
    atRisk,
  };
}

/**
 * Generate autonomous drop-and-reroute decisions for a list of SLA evaluations.
 * P0/P1: keep and reroute with priority.
 * P2/P3 that are at risk or breached: drop to waypoint.
 */
export function computeTriageDecisions(
  evaluations: SlaBreach[],
  waypoint: string,
  deviceId: string,
): TriageDecision[] {
  const nowMs = Date.now();
  return evaluations.map(ev => {
    const isHighPriority = ev.priority === 'P0' || ev.priority === 'P1';

    if (isHighPriority && (ev.breached || ev.atRisk)) {
      const rationale = ev.breached
        ? `${ev.priority} cargo "${ev.label}" has breached its SLA deadline. Route recalculated to prioritize delivery.`
        : `${ev.priority} cargo "${
            ev.label
          }" has <20% time headroom (${Math.round(
            ev.msUntilBreach / 60000,
          )}min remaining). Rerouting immediately.`;
      return {
        decisionId: `DEC-${nowMs}-${ev.cargoId.slice(-4)}`,
        cargoId: ev.cargoId,
        decisionType: 'reroute_priority',
        priority: ev.priority,
        rationale,
        decidedAtMs: nowMs,
      };
    }

    if (!isHighPriority && (ev.breached || ev.atRisk)) {
      const rationale =
        `${ev.priority} cargo "${ev.label}" will miss SLA. Instructing driver to deposit at waypoint "${waypoint}" ` +
        `to free capacity for critical cargo. This decision was made autonomously based on route condition analysis.`;
      return {
        decisionId: `DEC-${nowMs}-${ev.cargoId.slice(-4)}`,
        cargoId: ev.cargoId,
        decisionType: 'drop_to_waypoint',
        priority: ev.priority,
        rationale,
        waypoint,
        decidedAtMs: nowMs,
      };
    }

    return {
      decisionId: `DEC-${nowMs}-${ev.cargoId.slice(-4)}`,
      cargoId: ev.cargoId,
      decisionType: 'keep',
      priority: ev.priority,
      rationale: `${ev.priority} cargo "${ev.label}" is on track. No action required.`,
      decidedAtMs: nowMs,
    };
  });
}

/**
 * Determine overall fleet status after decisions.
 * Returns arrays of cargo IDs to keep vs drop.
 */
export function splitFleet(decisions: TriageDecision[]): {
  keep: string[];
  drop: string[];
} {
  const keep: string[] = [];
  const drop: string[] = [];
  for (const d of decisions) {
    if (d.decisionType === 'drop_to_waypoint') {
      drop.push(d.cargoId);
    } else {
      keep.push(d.cargoId);
    }
  }
  return { keep, drop };
}
