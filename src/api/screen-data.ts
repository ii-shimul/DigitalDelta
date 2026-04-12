import type { Scalar as SQLiteScalar } from '@op-engineering/op-sqlite';

import {
  createSQLiteAuthService,
  createSQLiteLedgerService,
  encodeUtf8,
  tickVectorClock,
  type AppRole,
  type ConflictResolutionChoice,
  type LedgerEntityKind,
} from '../core';

import { getDatabase } from '../db';

import type {
  ConnectivityState,
  DashboardConflictSummary,
  DashboardNodeHealth,
  DashboardRouteSummary,
  DashboardScreenData,
  DashboardSupplySummary,
  DashboardSyncSummary,
  DashboardTriageAlert,
  LoginScreenData,
} from './screen-contracts';

type LoginScreenQueryInput = {
  userId?: string;
  deviceId?: string;
};

export type ResolveDashboardConflictInput = {
  conflictId: string;
  resolution: ConflictResolutionChoice;
  actor: {
    userId: string;
    deviceId: string;
    role: AppRole;
  };
};

type Scalar = SQLiteScalar | undefined;

export async function getLoginScreenData(
  input: LoginScreenQueryInput = {},
): Promise<LoginScreenData | null> {
  const db = await getDatabase();
  const { query, params } = buildLoginScreenQuery(input);
  const result = await db.execute(query, params);
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    userId: asString(row.userId),
    deviceId: asString(row.deviceId),
    displayName: asString(row.displayName),
    primaryRole: asString(row.primaryRole),
    roles: parseJsonStringArray(row.rolesJson),
    keyProvisioned: Boolean(row.keyProvisioned),
    keyAlgorithm: asOptionalString(row.keyAlgorithm),
    keyFingerprint: asOptionalString(row.keyFingerprint),
    lastLoginAtMs: asOptionalNumber(row.lastLoginAtMs),
    authFailureReason: asOptionalString(row.authFailureReason),
  };
}

export async function getDashboardScreenData(): Promise<DashboardScreenData> {
  const db = await getDatabase();

  const [
    routesResult,
    suppliesResult,
    nodeHealthResult,
    triageResult,
    conflictsResult,
    syncResult,
  ] = await Promise.all([
    db.execute(dashboardRoutesQuery),
    db.execute(dashboardSuppliesQuery),
    db.execute(dashboardNodeHealthQuery),
    db.execute(dashboardTriageAlertsQuery),
    db.execute(dashboardConflictsQuery),
    db.execute(dashboardSyncSummaryQuery),
  ]);

  const routes = routesResult.rows.map<DashboardRouteSummary>(row => ({
    deliveryId: asString(row.deliveryId),
    routeId: asOptionalString(row.routeId),
    priorityTier: asString(row.priorityTier),
    status: asString(row.status),
    etaMinutes: asOptionalNumber(row.etaMinutes),
    totalRiskScore: asOptionalNumber(row.totalRiskScore),
    requiresHandoff: Boolean(row.requiresHandoff),
    computedAtMs: asOptionalNumber(row.computedAtMs),
  }));

  const supplies = suppliesResult.rows.map<DashboardSupplySummary>(row => ({
    inventoryItemId: asString(row.inventoryItemId),
    itemName: asString(row.itemName),
    category: asString(row.category),
    quantity: asNumber(row.quantity),
    unit: asString(row.unit),
    storageNodeId: asString(row.storageNodeId),
    status: asString(row.status),
    updatedAtMs: asNumber(row.updatedAtMs),
  }));

  const nodeHealth = nodeHealthResult.rows.map<DashboardNodeHealth>(row => ({
    vehicleId: asString(row.vehicleId),
    vehicleType: asString(row.vehicleType),
    status: asString(row.status),
    batteryPercent: asOptionalNumber(row.batteryPercent),
    currentNodeId: asOptionalString(row.currentNodeId),
    lastSeenAtMs: asOptionalNumber(row.lastSeenAtMs),
  }));

  const triageAlerts = triageResult.rows.map<DashboardTriageAlert>(row => ({
    deliveryId: asString(row.deliveryId),
    highestRemainingPriority: asString(row.highestRemainingPriority),
    preempted: Boolean(row.preempted),
    safeWaypointNodeId: asOptionalString(row.safeWaypointNodeId),
    rationale: asString(row.rationale),
    decidedAtMs: asNumber(row.decidedAtMs),
  }));

  const conflicts = conflictsResult.rows.map<DashboardConflictSummary>(row => ({
    conflictId: asString(row.conflictId),
    entityType: asString(row.entityType),
    entityId: asString(row.entityId),
    fieldName: asString(row.fieldName),
    localValueText: deriveConflictValueText({
      side: 'local',
      valueBlob: asBlob(row.localValueBlob),
      metadata: parseJsonRecord(row.metadataJson),
    }),
    remoteValueText: deriveConflictValueText({
      side: 'remote',
      valueBlob: asBlob(row.remoteValueBlob),
      metadata: parseJsonRecord(row.metadataJson),
    }),
    resolutionText: asOptionalString(row.resolutionText),
    createdAtMs: asNumber(row.createdAtMs),
    resolvedAtMs: asOptionalNumber(row.resolvedAtMs),
  }));

  const syncRow = syncResult.rows[0] ?? {};
  const sync: DashboardSyncSummary = {
    peerCount: asNumber(syncRow.peerCount ?? 0),
    queuedEnvelopeCount: asNumber(syncRow.queuedEnvelopeCount ?? 0),
    inFlightEnvelopeCount: asNumber(syncRow.inFlightEnvelopeCount ?? 0),
    lastSyncedAtMs: asOptionalNumber(syncRow.lastSyncedAtMs),
  };

  return {
    connectivityState: deriveConnectivityState(conflicts, sync),
    routes,
    supplies,
    nodeHealth,
    triageAlerts,
    conflicts,
    sync,
  };
}

export async function resolveDashboardConflict(
  input: ResolveDashboardConflictInput,
): Promise<{ resolutionEventId: string; resolvedAtMs: number }> {
  const db = await getDatabase();
  const conflictResult = await db.execute(
    `
      SELECT
        conflict_id AS conflictId,
        entity_type AS entityType,
        entity_id AS entityId,
        field_name AS fieldName,
        metadata_json AS metadataJson,
        local_value_blob AS localValueBlob,
        remote_value_blob AS remoteValueBlob
      FROM conflicts
      WHERE conflict_id = ?
      LIMIT 1
    `,
    [input.conflictId],
  );
  const conflictRow = conflictResult.rows[0];

  if (!conflictRow) {
    throw new Error(`Conflict ${input.conflictId} not found.`);
  }

  const entityType = normalizeLedgerEntityKind(conflictRow.entityType);
  const authService = createSQLiteAuthService();
  const hasWritePermission = await authService.hasPermission({
    actor: {
      userId: input.actor.userId,
      deviceId: input.actor.deviceId,
      role: input.actor.role,
    },
    resource: entityType,
    action: 'write',
  });

  if (!hasWritePermission) {
    throw new Error(
      `Role ${input.actor.role} is not permitted to resolve ${entityType} conflicts.`,
    );
  }

  const resolvedAtMs = Date.now();
  const resolutionEventId = createResolutionEventId();
  const metadata = parseJsonRecord(conflictRow.metadataJson);

  await db.execute(
    `
      UPDATE conflicts
      SET
        resolution_text = ?,
        resolution_event_id = ?,
        resolved_at_ms = ?,
        metadata_json = ?
      WHERE conflict_id = ?
    `,
    [
      buildResolutionText(input.resolution),
      resolutionEventId,
      resolvedAtMs,
      JSON.stringify({
        ...metadata,
        resolutionChoice: input.resolution,
        resolvedByUserId: input.actor.userId,
        resolvedByDeviceId: input.actor.deviceId,
        resolvedByRole: input.actor.role,
      }),
      input.conflictId,
    ],
  );

  const ledgerService = createSQLiteLedgerService(async () => db);
  const previousClock = await ledgerService.getLatestVectorClockForDevice(
    input.actor.deviceId,
  );

  await ledgerService.appendEvent({
    eventId: resolutionEventId,
    entityType,
    entityId: asString(conflictRow.entityId),
    eventType: 'conflict_resolved',
    actor: {
      userId: input.actor.userId,
      deviceId: input.actor.deviceId,
      role: input.actor.role,
    },
    occurredAtMs: resolvedAtMs,
    vectorClock: tickVectorClock(previousClock, input.actor.deviceId),
    payloadType: 'digitaldelta.v1.conflict.resolution',
    payloadBlob: encodeUtf8(
      JSON.stringify({
        conflictId: input.conflictId,
        fieldName: asString(conflictRow.fieldName),
        resolution: input.resolution,
      }),
    ),
    metadata: {
      conflictId: input.conflictId,
      resolution: input.resolution,
      localValue: deriveConflictValueText({
        side: 'local',
        valueBlob: asBlob(conflictRow.localValueBlob),
        metadata,
      }),
      remoteValue: deriveConflictValueText({
        side: 'remote',
        valueBlob: asBlob(conflictRow.remoteValueBlob),
        metadata,
      }),
    },
  });

  return {
    resolutionEventId,
    resolvedAtMs,
  };
}

function buildLoginScreenQuery(input: LoginScreenQueryInput): {
  query: string;
  params: Array<string>;
} {
  const filters: string[] = [];
  const params: string[] = [];

  if (input.userId) {
    filters.push('u.user_id = ?');
    params.push(input.userId);
  }

  if (input.deviceId) {
    filters.push('di.device_id = ?');
    params.push(input.deviceId);
  }

  const whereClause =
    filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  return {
    query: `
      SELECT
        u.user_id AS userId,
        COALESCE(di.device_id, '') AS deviceId,
        u.display_name AS displayName,
        u.primary_role AS primaryRole,
        u.roles_json AS rolesJson,
        CASE WHEN di.device_id IS NULL THEN 0 ELSE 1 END AS keyProvisioned,
        di.key_algorithm AS keyAlgorithm,
        di.key_fingerprint AS keyFingerprint,
        u.last_login_at_ms AS lastLoginAtMs,
        aal.failure_reason AS authFailureReason
      FROM users u
      LEFT JOIN device_identity di
        ON di.user_id = u.user_id
      LEFT JOIN auth_audit_log aal
        ON aal.user_id = u.user_id
        AND aal.failure_reason IS NOT NULL
        AND aal.occurred_at_ms = (
          SELECT MAX(inner_aal.occurred_at_ms)
          FROM auth_audit_log inner_aal
          WHERE inner_aal.user_id = u.user_id
            AND inner_aal.failure_reason IS NOT NULL
        )
      ${whereClause}
      ORDER BY COALESCE(u.last_login_at_ms, u.updated_at_ms, u.created_at_ms) DESC,
        di.provisioned_at_ms DESC
      LIMIT 1
    `,
    params,
  };
}

function deriveConnectivityState(
  conflicts: DashboardConflictSummary[],
  sync: DashboardSyncSummary,
): ConnectivityState {
  const hasUnresolvedConflict = conflicts.some(
    conflict => !conflict.resolvedAtMs,
  );
  if (hasUnresolvedConflict) {
    return 'conflict-detected';
  }

  if (sync.queuedEnvelopeCount > 0 || sync.inFlightEnvelopeCount > 0) {
    return 'syncing';
  }

  if (typeof sync.lastSyncedAtMs === 'number') {
    return 'verified';
  }

  return 'offline';
}

function parseJsonStringArray(value: Scalar): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(item => typeof item === 'string');
  } catch {
    return [];
  }
}

function asString(value: Scalar): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function asOptionalString(value: Scalar): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Scalar): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsedNumber = Number(value);
    return Number.isFinite(parsedNumber) ? parsedNumber : 0;
  }

  return 0;
}

function asOptionalNumber(value: Scalar): number | undefined {
  if (value === null || typeof value === 'undefined') {
    return undefined;
  }

  const numberValue = asNumber(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

const dashboardRoutesQuery = `
  SELECT
    d.delivery_id AS deliveryId,
    rp.route_id AS routeId,
    d.priority_tier AS priorityTier,
    d.status AS status,
    COALESCE(rp.total_eta_minutes, d.eta_minutes) AS etaMinutes,
    rp.total_risk_score AS totalRiskScore,
    COALESCE(rp.requires_handoff, d.requires_handoff, 0) AS requiresHandoff,
    rp.computed_at_ms AS computedAtMs
  FROM deliveries d
  LEFT JOIN route_plans rp
    ON rp.route_id = d.current_route_id
  ORDER BY d.updated_at_ms DESC, d.created_at_ms DESC
`;

const dashboardSuppliesQuery = `
  SELECT
    inventory_item_id AS inventoryItemId,
    item_name AS itemName,
    category,
    quantity,
    unit,
    storage_node_id AS storageNodeId,
    status,
    updated_at_ms AS updatedAtMs
  FROM supply_inventory
  ORDER BY updated_at_ms DESC
`;

const dashboardNodeHealthQuery = `
  SELECT
    vehicle_id AS vehicleId,
    vehicle_type AS vehicleType,
    status,
    battery_percent AS batteryPercent,
    current_node_id AS currentNodeId,
    last_seen_at_ms AS lastSeenAtMs
  FROM vehicles
  ORDER BY COALESCE(last_seen_at_ms, 0) DESC, vehicle_id ASC
`;

const dashboardTriageAlertsQuery = `
  SELECT
    delivery_id AS deliveryId,
    highest_remaining_priority AS highestRemainingPriority,
    preempted,
    safe_waypoint_node_id AS safeWaypointNodeId,
    rationale,
    decided_at_ms AS decidedAtMs
  FROM triage_decisions
  ORDER BY decided_at_ms DESC
`;

const dashboardConflictsQuery = `
  SELECT
    conflict_id AS conflictId,
    entity_type AS entityType,
    entity_id AS entityId,
    field_name AS fieldName,
    local_value_blob AS localValueBlob,
    remote_value_blob AS remoteValueBlob,
    metadata_json AS metadataJson,
    resolution_text AS resolutionText,
    created_at_ms AS createdAtMs,
    resolved_at_ms AS resolvedAtMs
  FROM conflicts
  ORDER BY created_at_ms DESC
`;

function deriveConflictValueText(input: {
  side: 'local' | 'remote';
  valueBlob?: Uint8Array;
  metadata: Record<string, unknown>;
}): string | undefined {
  const preferredKeys =
    input.side === 'local'
      ? ['localValue', 'localQuantity', 'local_value']
      : ['remoteValue', 'remoteQuantity', 'remote_value'];

  for (const key of preferredKeys) {
    if (!(key in input.metadata)) {
      continue;
    }

    const formatted = formatConflictValue(input.metadata[key]);
    if (formatted) {
      return formatted;
    }
  }

  return decodeConflictBlob(input.valueBlob);
}

function formatConflictValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return undefined;
}

function decodeConflictBlob(valueBlob?: Uint8Array): string | undefined {
  if (!valueBlob || valueBlob.length === 0) {
    return undefined;
  }

  const asciiText = Array.from(valueBlob)
    .map(byte =>
      byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ',
    )
    .join('')
    .trim();

  if (asciiText.length > 0) {
    return asciiText;
  }

  const hex = Array.from(valueBlob)
    .slice(0, 12)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}${valueBlob.length > 12 ? '…' : ''}`;
}

function createResolutionEventId(): string {
  return `evt-cnf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildResolutionText(resolution: ConflictResolutionChoice): string {
  switch (resolution) {
    case 'local':
      return 'Applied local value after operator review.';
    case 'remote':
      return 'Applied peer value after operator review.';
    case 'merged':
      return 'Merged local and peer values and committed decision.';
    case 'manual':
    default:
      return 'Applied manual override after conflict review.';
  }
}

function normalizeLedgerEntityKind(value: Scalar): LedgerEntityKind {
  const entityType = asString(value);
  const allowedTypes = new Set<LedgerEntityKind>([
    'auth_session',
    'device',
    'user',
    'supply_item',
    'delivery',
    'route',
    'receipt',
    'handoff',
    'triage_decision',
    'edge_status',
  ]);

  return allowedTypes.has(entityType as LedgerEntityKind)
    ? (entityType as LedgerEntityKind)
    : 'supply_item';
}

function asBlob(value: Scalar): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}

function parseJsonRecord(value: Scalar): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    return parsedValue as Record<string, unknown>;
  } catch {
    return {};
  }
}

const dashboardSyncSummaryQuery = `
  SELECT
    (SELECT COUNT(*) FROM sync_peers) AS peerCount,
    (
      SELECT COUNT(*)
      FROM sync_outbox
      WHERE status IN ('queued', 'pending', 'retry')
    ) AS queuedEnvelopeCount,
    (
      SELECT COUNT(*)
      FROM sync_outbox
      WHERE status IN ('sending', 'sent', 'awaiting_ack')
    ) AS inFlightEnvelopeCount,
    (SELECT MAX(last_synced_at_ms) FROM sync_peers) AS lastSyncedAtMs
`;
