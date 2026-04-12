import type { AppRole, LedgerEntityKind, PermissionAction } from '../contracts';

const PERMISSION_MATRIX: Record<
  AppRole,
  Partial<Record<LedgerEntityKind, readonly PermissionAction[]>>
> = {
  FIELD_VOLUNTEER: {
    auth_session: ['read'],
    delivery: ['read'],
    edge_status: ['read', 'write'],
    handoff: ['read', 'execute'],
    receipt: ['read', 'write', 'execute'],
    route: ['read'],
    supply_item: ['read'],
    user: ['read'],
  },
  SUPPLY_MANAGER: {
    auth_session: ['read', 'write'],
    delivery: ['read', 'write', 'execute'],
    device: ['read'],
    edge_status: ['read', 'write'],
    receipt: ['read', 'write'],
    route: ['read', 'write', 'execute'],
    supply_item: ['read', 'write'],
    triage_decision: ['read', 'write', 'execute'],
    user: ['read'],
  },
  DRONE_OPERATOR: {
    auth_session: ['read', 'write'],
    delivery: ['read'],
    device: ['read'],
    edge_status: ['read'],
    handoff: ['read', 'write', 'execute'],
    receipt: ['read', 'write', 'execute'],
    route: ['read', 'write', 'execute'],
    user: ['read'],
  },
  CAMP_COMMANDER: {
    auth_session: ['read'],
    delivery: ['read'],
    receipt: ['read', 'write', 'execute'],
    route: ['read'],
    supply_item: ['read'],
    triage_decision: ['read'],
    user: ['read'],
  },
  SYNC_ADMIN: {
    auth_session: ['read', 'write', 'execute'],
    delivery: ['read', 'write', 'execute'],
    device: ['read', 'write', 'execute'],
    edge_status: ['read', 'write', 'execute'],
    handoff: ['read', 'write', 'execute'],
    receipt: ['read', 'write', 'execute'],
    route: ['read', 'write', 'execute'],
    supply_item: ['read', 'write', 'execute'],
    triage_decision: ['read', 'write', 'execute'],
    user: ['read', 'write', 'execute'],
  },
};

export function hasRolePermission(
  role: AppRole,
  resource: LedgerEntityKind,
  action: PermissionAction,
): boolean {
  return Boolean(PERMISSION_MATRIX[role][resource]?.includes(action));
}
