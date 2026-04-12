/** @jsxImportSource nativewind */

import { Pressable, Text, View } from 'react-native';

import type { AppScreen } from '../../navigation/contracts';

type ScreenAccessGridProps = {
  screens: readonly AppScreen[];
  allowedScreens: readonly AppScreen[];
  selectedScreen: AppScreen;
  onSelect: (screen: AppScreen) => void;
};

export function ScreenAccessGrid({
  screens,
  allowedScreens,
  selectedScreen,
  onSelect,
}: ScreenAccessGridProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {screens.map(screen => {
        const allowed = allowedScreens.includes(screen);
        const selected = selectedScreen === screen;

        return (
          <Pressable
            key={screen}
            accessibilityRole="button"
            disabled={!allowed}
            onPress={() => onSelect(screen)}
            className={buildScreenClassName({ allowed, selected })}
          >
            <Text className={buildScreenTextClassName({ allowed, selected })}>
              {screen}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function buildScreenClassName(input: {
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

function buildScreenTextClassName(input: {
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
