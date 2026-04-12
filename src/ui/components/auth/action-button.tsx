/** @jsxImportSource nativewind */

import { ActivityIndicator, Pressable, Text } from 'react-native';

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
};

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
}: ActionButtonProps) {
  const isInactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isInactive}
      onPress={onPress}
      className={buildButtonClassName(variant, isInactive)}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'secondary' ? '#1d2f35' : '#f8fffd'}
        />
      ) : null}
      <Text className={buildTextClassName(variant)}>{label}</Text>
    </Pressable>
  );
}

function buildButtonClassName(
  variant: NonNullable<ActionButtonProps['variant']>,
  isInactive: boolean,
): string {
  const baseClassName =
    'min-h-[50px] flex-row items-center justify-center rounded-2xl px-4 py-3';

  if (isInactive) {
    return `${baseClassName} bg-delta-line opacity-60`;
  }

  if (variant === 'secondary') {
    return `${baseClassName} bg-slate-200`;
  }

  if (variant === 'danger') {
    return `${baseClassName} bg-delta-danger`;
  }

  return `${baseClassName} bg-delta-forest`;
}

function buildTextClassName(
  variant: NonNullable<ActionButtonProps['variant']>,
): string {
  if (variant === 'secondary') {
    return 'text-sm font-bold text-slate-800';
  }

  return 'text-sm font-bold text-white';
}
