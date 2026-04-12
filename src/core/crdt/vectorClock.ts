export type VectorClockMap = Record<string, number>;

export type VectorClockRelation = 'equal' | 'before' | 'after' | 'concurrent';

export function createVectorClock(seed: VectorClockMap = {}): VectorClockMap {
  return normalizeVectorClock(seed);
}

export function normalizeVectorClock(clock: VectorClockMap): VectorClockMap {
  const normalizedEntries = Object.entries(clock)
    .filter(([actorId]) => actorId.length > 0)
    .map(([actorId, counter]) => [actorId, normalizeCounter(counter)] as const)
    .filter(([, counter]) => counter > 0)
    .sort(([leftActorId], [rightActorId]) =>
      leftActorId.localeCompare(rightActorId),
    );

  return Object.fromEntries(normalizedEntries);
}

export function tickVectorClock(
  clock: VectorClockMap,
  actorId: string,
): VectorClockMap {
  const nextClock = normalizeVectorClock(clock);
  const nextCounter = (nextClock[actorId] ?? 0) + 1;

  return normalizeVectorClock({
    ...nextClock,
    [actorId]: nextCounter,
  });
}

export function mergeVectorClocks(
  leftClock: VectorClockMap,
  rightClock: VectorClockMap,
): VectorClockMap {
  const merged: VectorClockMap = {};
  const actorIds = new Set([
    ...Object.keys(leftClock),
    ...Object.keys(rightClock),
  ]);

  for (const actorId of actorIds) {
    merged[actorId] = Math.max(
      normalizeCounter(leftClock[actorId] ?? 0),
      normalizeCounter(rightClock[actorId] ?? 0),
    );
  }

  return normalizeVectorClock(merged);
}

export function compareVectorClocks(
  leftClock: VectorClockMap,
  rightClock: VectorClockMap,
): VectorClockRelation {
  const left = normalizeVectorClock(leftClock);
  const right = normalizeVectorClock(rightClock);
  const actorIds = new Set([...Object.keys(left), ...Object.keys(right)]);

  let leftIsAhead = false;
  let rightIsAhead = false;

  for (const actorId of actorIds) {
    const leftCounter = left[actorId] ?? 0;
    const rightCounter = right[actorId] ?? 0;

    if (leftCounter > rightCounter) {
      leftIsAhead = true;
    }

    if (rightCounter > leftCounter) {
      rightIsAhead = true;
    }
  }

  if (!leftIsAhead && !rightIsAhead) {
    return 'equal';
  }

  if (leftIsAhead && rightIsAhead) {
    return 'concurrent';
  }

  return leftIsAhead ? 'after' : 'before';
}

export function serializeVectorClock(clock: VectorClockMap): string {
  return JSON.stringify(normalizeVectorClock(clock));
}

export function deserializeVectorClock(
  serializedClock?: string | null,
): VectorClockMap {
  if (!serializedClock) {
    return {};
  }

  let parsedClock: unknown;

  try {
    parsedClock = JSON.parse(serializedClock) as unknown;
  } catch {
    return {};
  }

  if (
    !parsedClock ||
    typeof parsedClock !== 'object' ||
    Array.isArray(parsedClock)
  ) {
    return {};
  }

  return normalizeVectorClock(parsedClock as VectorClockMap);
}

export function hasSeenCounter(
  clock: VectorClockMap,
  actorId: string,
  counter: number,
): boolean {
  return normalizeCounter(clock[actorId] ?? 0) >= normalizeCounter(counter);
}

function normalizeCounter(counter: number): number {
  if (!Number.isFinite(counter) || counter <= 0) {
    return 0;
  }

  return Math.floor(counter);
}
