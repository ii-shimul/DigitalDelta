import { getDatabase } from '../db';
import type { RegisteredUser } from './auth';
import { bytesToHex, computeSha256Hex, randomBytes } from '../core/auth/crypto';
import {
  type CargoPriority,
  type CargoStatus,
  type TriageDecision,
  PRIORITY_META,
  computeTriageDecisions,
  evaluateSla,
  splitFleet,
} from '../core/triage/engine';

export type { CargoPriority, CargoStatus, TriageDecision };

export type CargoDraft = {
  label: string;
  description?: string;
  priority: CargoPriority;
  /** ETA offset from now in milliseconds (e.g. 3600000 = 1 hour away) */
  etaOffsetMs: number;
};

export type CargoRecord = {
  cargoId: string;
  label: string;
  description: string;
  priority: CargoPriority;
  slaWindowMs: number;
  createdAtMs: number;
  etaMs: number;
  routeSlowdownPct: number;
  status: CargoStatus;
  waypointLabel: string | null;
  resolvedAtMs: number | null;
  deviceId: string;
};

export type TriageDecisionRecord = {
  decisionId: string;
  cargoId: string;
  decisionType: string;
  priority: CargoPriority;
  rationale: string;
  waypoint: string | null;
  decidedAtMs: number;
  deviceId: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToCargoRecord(row: Record<string, unknown>): CargoRecord {
  return {
    cargoId: row.cargo_id as string,
    label: row.label as string,
    description: (row.description as string) ?? '',
    priority: row.priority as CargoPriority,
    slaWindowMs: row.sla_window_ms as number,
    createdAtMs: row.created_at_ms as number,
    etaMs: row.eta_ms as number,
    routeSlowdownPct: row.route_slowdown_pct as number,
    status: row.status as CargoStatus,
    waypointLabel: (row.waypoint_label as string | null) ?? null,
    resolvedAtMs: (row.resolved_at_ms as number | null) ?? null,
    deviceId: row.device_id as string,
  };
}

function rowToDecision(row: Record<string, unknown>): TriageDecisionRecord {
  return {
    decisionId: row.decision_id as string,
    cargoId: row.cargo_id as string,
    decisionType: row.decision_type as string,
    priority: row.priority as CargoPriority,
    rationale: row.rationale as string,
    waypoint: (row.waypoint as string | null) ?? null,
    decidedAtMs: row.decided_at_ms as number,
    deviceId: row.device_id as string,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add a single cargo item from user input.
 */
export async function addCargo(
  user: RegisteredUser,
  draft: CargoDraft,
): Promise<string> {
  const db = await getDatabase();
  const nowMs = Date.now();
  const cargoId = `CGO-${bytesToHex(randomBytes(4)).toUpperCase()}`;
  await db.execute(
    `INSERT INTO triage_cargo
       (cargo_id, label, description, priority, sla_window_ms, created_at_ms, eta_ms,
        route_slowdown_pct, status, waypoint_label, resolved_at_ms, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', NULL, NULL, ?)`,
    [
      cargoId,
      draft.label,
      draft.description ?? '',
      draft.priority,
      PRIORITY_META[draft.priority].slaWindowMs,
      nowMs,
      nowMs + draft.etaOffsetMs,
      user.deviceId,
    ],
  );
  return cargoId;
}

export async function getAllCargo(): Promise<CargoRecord[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM triage_cargo ORDER BY priority ASC, created_at_ms ASC`,
  );
  return result.rows.map(rowToCargoRecord);
}

export async function getTriageDecisions(): Promise<TriageDecisionRecord[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM triage_decisions ORDER BY decided_at_ms DESC LIMIT 50`,
  );
  return result.rows.map(rowToDecision);
}

/**
 * Inject a route slowdown on all active cargo and predict SLA breaches (M6.2).
 * slowdownPct: e.g. 40 = 40% slower (>=30 triggers the preemption evaluation).
 */
export async function injectRouteSlowdown(
  user: RegisteredUser,
  slowdownPct: number,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE triage_cargo SET route_slowdown_pct = ?
     WHERE status IN ('active', 'at_risk') AND device_id = ?`,
    [slowdownPct, user.deviceId],
  );

  // Re-evaluate statuses after slowdown
  const cargo = await getAllCargo();
  const nowMs = Date.now();
  for (const c of cargo) {
    if (c.status === 'dropped' || c.status === 'delivered') {
      continue;
    }
    const ev = evaluateSla({
      cargoId: c.cargoId,
      label: c.label,
      priority: c.priority,
      createdAtMs: c.createdAtMs,
      etaMs: c.etaMs,
      routeSlowdownPct: c.routeSlowdownPct,
    });
    let newStatus: CargoStatus = 'active';
    if (ev.breached) {
      newStatus = 'breached';
    } else if (ev.atRisk) {
      newStatus = 'at_risk';
    }
    if (newStatus !== c.status) {
      await db.execute(
        `UPDATE triage_cargo SET status = ? WHERE cargo_id = ?`,
        [newStatus, c.cargoId],
      );
    }
  }
}

/**
 * Run autonomous triage: evaluate all at-risk/breached cargo and log decisions (M6.3).
 * Returns the decisions made.
 */
export async function runAutonomousTriage(
  user: RegisteredUser,
  waypoint: string = 'Safe Waypoint — Sunamganj Bridge',
): Promise<TriageDecisionRecord[]> {
  const db = await getDatabase();
  const cargo = await getAllCargo();
  const active = cargo.filter(
    c => c.status !== 'dropped' && c.status !== 'delivered',
  );

  const evaluations = active.map(c =>
    evaluateSla({
      cargoId: c.cargoId,
      label: c.label,
      priority: c.priority,
      createdAtMs: c.createdAtMs,
      etaMs: c.etaMs,
      routeSlowdownPct: c.routeSlowdownPct,
    }),
  );

  const decisions = computeTriageDecisions(
    evaluations,
    waypoint,
    user.deviceId,
  );
  const { drop } = splitFleet(decisions);
  const nowMs = Date.now();

  const savedDecisions: TriageDecisionRecord[] = [];

  for (const dec of decisions) {
    // Persist decision
    await db.execute(
      `INSERT OR REPLACE INTO triage_decisions
         (decision_id, cargo_id, decision_type, priority, rationale, waypoint, decided_at_ms, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dec.decisionId,
        dec.cargoId,
        dec.decisionType,
        dec.priority,
        dec.rationale,
        dec.waypoint ?? null,
        dec.decidedAtMs,
        user.deviceId,
      ],
    );

    // Update cargo status if dropped
    if (dec.decisionType === 'drop_to_waypoint') {
      await db.execute(
        `UPDATE triage_cargo
         SET status = 'dropped', waypoint_label = ?, resolved_at_ms = ?
         WHERE cargo_id = ?`,
        [dec.waypoint ?? waypoint, nowMs, dec.cargoId],
      );
    }

    // Append to auth audit trail for immutable record (M6.3 requirement)
    const auditPayload = JSON.stringify({
      event: 'TRIAGE_DECISION',
      decisionId: dec.decisionId,
      cargoId: dec.cargoId,
      decisionType: dec.decisionType,
      priority: dec.priority,
      rationale: dec.rationale,
      waypoint: dec.waypoint,
      deviceId: user.deviceId,
      userId: user.userId,
      ts: nowMs,
    });

    const logId = `TRG-${bytesToHex(randomBytes(6)).toUpperCase()}`;
    const payloadHash = await computeSha256Hex(auditPayload);

    // Get previous hash from auth_audit_log for chain continuity
    const prev = await db.execute(
      `SELECT current_hash FROM auth_audit_log ORDER BY occurred_at_ms DESC LIMIT 1`,
    );
    const previousHash = prev.rows[0]?.current_hash
      ? (prev.rows[0].current_hash as string)
      : null;

    const chainInput = previousHash ? previousHash + payloadHash : payloadHash;
    const currentHash = await computeSha256Hex(chainInput);

    await db.execute(
      `INSERT INTO auth_audit_log
         (log_id, auth_event_id, event_type, user_id, device_id, previous_hash,
          payload_hash, current_hash, occurred_at_ms, event_blob, metadata_json)
       VALUES (?, ?, 'TRIAGE_DECISION', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        dec.decisionId,
        user.userId,
        user.deviceId,
        previousHash,
        payloadHash,
        currentHash,
        nowMs,
        auditPayload,
        JSON.stringify({
          decisionType: dec.decisionType,
          priority: dec.priority,
        }),
      ],
    );

    savedDecisions.push({
      decisionId: dec.decisionId,
      cargoId: dec.cargoId,
      decisionType: dec.decisionType,
      priority: dec.priority,
      rationale: dec.rationale,
      waypoint: dec.waypoint ?? null,
      decidedAtMs: dec.decidedAtMs,
      deviceId: user.deviceId,
    });
  }

  return savedDecisions;
}

/**
 * Reset all cargo to active with 0% slowdown (for re-demo).
 */
export async function resetTriage(user: RegisteredUser): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE triage_cargo
     SET status = 'active', route_slowdown_pct = 0, waypoint_label = NULL, resolved_at_ms = NULL
     WHERE device_id = ?`,
    [user.deviceId],
  );
}
