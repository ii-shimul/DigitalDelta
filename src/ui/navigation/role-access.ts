import type { AuthRole } from '../../api';

import type { BottomTabScreen } from './contracts';
import { BOTTOM_TAB_SCREENS } from './contracts';

export const ROLE_ALLOWED_SCREENS: Record<AuthRole, BottomTabScreen[]> = {
  FIELD_VOLUNTEER: [...BOTTOM_TAB_SCREENS],
  SUPPLY_MANAGER: [...BOTTOM_TAB_SCREENS],
  DRONE_OPERATOR: ['Command', 'Scanner', 'Mesh', 'Identity'],
  CAMP_COMMANDER: ['Command', 'Inventory', 'Identity'],
  SYNC_ADMIN: ['Command', 'Mesh', 'Identity'],
};

/** Bottom tabs only (excludes HandoffFlow overlay). */
export const OPERATIONS_SCREENS: readonly BottomTabScreen[] = [
  ...BOTTOM_TAB_SCREENS,
];

const ROLES_WITH_HANDOFF: AuthRole[] = ['SUPPLY_MANAGER', 'DRONE_OPERATOR'];

export function roleAllowsHandoff(role: AuthRole): boolean {
  return ROLES_WITH_HANDOFF.includes(role);
}
