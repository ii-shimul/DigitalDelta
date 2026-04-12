/** @jsxImportSource nativewind */

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

type SectionCardProps = {
  title: string;
  subtitle?: string;
  tone?: 'default' | 'success' | 'danger' | 'warning';
  children: ReactNode;
};

export function SectionCard({
  title,
  subtitle,
  tone = 'default',
  children,
}: SectionCardProps) {
  return (
    <View className={buildCardClassName(tone)}>
      <View className="gap-1">
        <Text className="text-lg font-extrabold text-delta-ink">{title}</Text>
        {subtitle ? (
          <Text className="text-sm leading-5 text-delta-smoke">{subtitle}</Text>
        ) : null}
      </View>
      <View className="gap-3">{children}</View>
    </View>
  );
}

function buildCardClassName(
  tone: NonNullable<SectionCardProps['tone']>,
): string {
  const baseClassName =
    'gap-4 rounded-[24px] border bg-delta-paper p-4 shadow-lift';

  if (tone === 'success') {
    return `${baseClassName} border-delta-success`;
  }

  if (tone === 'danger') {
    return `${baseClassName} border-delta-danger`;
  }

  if (tone === 'warning') {
    return `${baseClassName} border-amber-500`;
  }

  return `${baseClassName} border-delta-line`;
}
