/** @jsxImportSource nativewind */

import { Pressable, Text, View } from 'react-native';

import type { AuthRole } from '../../../api';

type RoleSelectorProps = {
  roles: readonly AuthRole[];
  selectedRole: AuthRole;
  allowedRoles: readonly AuthRole[];
  onSelect: (role: AuthRole) => void;
};

export function RoleSelector({
  roles,
  selectedRole,
  allowedRoles,
  onSelect,
}: RoleSelectorProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {roles.map(role => {
        const allowed = allowedRoles.includes(role);
        const selected = role === selectedRole;

        return (
          <Pressable
            key={role}
            accessibilityRole="button"
            disabled={!allowed}
            onPress={() => onSelect(role)}
            className={buildRoleClassName({ allowed, selected })}
          >
            <Text className={buildRoleTextClassName({ allowed, selected })}>
              {role}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function buildRoleClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  const baseClassName =
    'min-h-[46px] min-w-[144px] items-center justify-center rounded-2xl px-3 py-2';

  if (!input.allowed) {
    return `${baseClassName} bg-stone-200 opacity-60`;
  }

  if (input.selected) {
    return `${baseClassName} bg-delta-forest`;
  }

  return `${baseClassName} bg-[#e7ddd0]`;
}

function buildRoleTextClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  if (!input.allowed) {
    return 'text-center text-xs font-bold text-stone-500';
  }

  if (input.selected) {
    return 'text-center text-xs font-bold text-white';
  }

  return 'text-center text-xs font-bold text-[#253633]';
}
