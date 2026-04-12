import type {
  AppRole,
  ConflictResolutionChoice,
  LedgerEntityKind,
  LedgerEventKind,
  PriorityTier,
  RouteMode,
} from './contracts';

export const DIGITAL_DELTA_SCHEMA_VERSION = 'digitaldelta.v1' as const;

export const APP_ROLES = [
  'FIELD_VOLUNTEER',
  'SUPPLY_MANAGER',
  'DRONE_OPERATOR',
  'CAMP_COMMANDER',
  'SYNC_ADMIN',
] as const satisfies readonly AppRole[];

export const LEDGER_ENTITY_TYPES = [
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
] as const satisfies readonly LedgerEntityKind[];

export const LEDGER_EVENT_TYPES = [
  'auth',
  'inventory_mutation',
  'conflict_detected',
  'conflict_resolved',
  'route_updated',
  'pod_receipt',
  'handoff',
  'triage_decision',
  'mesh_role_changed',
  'edge_risk_updated',
] as const satisfies readonly LedgerEventKind[];

export const ROUTE_MODES = [
  'truck',
  'speedboat',
  'drone',
] as const satisfies readonly RouteMode[];

export const PRIORITY_TIERS = [
  'P0',
  'P1',
  'P2',
  'P3',
] as const satisfies readonly PriorityTier[];

export const CONFLICT_RESOLUTION_CHOICES = [
  'local',
  'remote',
  'merged',
  'manual',
] as const satisfies readonly ConflictResolutionChoice[];

export const DASHBOARD_CONNECTIVITY_STATES = [
  'offline',
  'syncing',
  'verified',
  'conflict-detected',
] as const;

export const SYNC_OUTBOX_QUEUED_STATUSES = [
  'queued',
  'pending',
  'retry',
] as const;

export const SYNC_OUTBOX_IN_FLIGHT_STATUSES = [
  'sending',
  'sent',
  'awaiting_ack',
] as const;

export const SYNC_CAPABILITIES = [
  'auth-events',
  'ledger-delta',
  'route-updates',
  'pod-receipts',
  'handoff-events',
  'triage-decisions',
] as const;

export function isAppRole(value: string): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

export function isLedgerEntityKind(value: string): value is LedgerEntityKind {
  return LEDGER_ENTITY_TYPES.includes(value as LedgerEntityKind);
}

export function isLedgerEventKind(value: string): value is LedgerEventKind {
  return LEDGER_EVENT_TYPES.includes(value as LedgerEventKind);
}

export function isPriorityTier(value: string): value is PriorityTier {
  return PRIORITY_TIERS.includes(value as PriorityTier);
}
