import {
  type VectorClockMap,
  compareVectorClocks,
  mergeVectorClocks,
  tickVectorClock,
} from './vectorClock';

export type SupplyItem = {
  itemId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  nodeId: string;
  vectorClock: VectorClockMap;
  updatedAtMs: number;
};

/**
 * M2.1 – OR-Set tag for supply item lifecycle.
 * An item is alive if at least one tag is NOT tombstoned.
 * Concurrent add+remove is safe: only the specific add-tag is removed.
 */
export type ORSetTag = {
  tagId: string;
  itemId: string;
  actorDeviceId: string;
  addedAtMs: number;
  tombstonedAtMs?: number;
  tombstoneDeviceId?: string;
};

/** True when an OR-Set of tags still has a live (non-tombstoned) entry. */
export function isORSetAlive(tags: ORSetTag[]): boolean {
  return tags.some(t => t.tombstonedAtMs == null);
}

/**
 * M2.2 – Single mutation history entry for causal chain reconstruction.
 * previousMutationId links entries into a causally-ordered linked list.
 */
export type MutationHistoryEntry = {
  mutationId: string;
  itemId: string;
  actorDeviceId: string;
  eventType: 'create' | 'update' | 'delete';
  oldQuantity?: number;
  newQuantity: number;
  vectorClock: VectorClockMap;
  previousMutationId?: string;
  occurredAtMs: number;
};

export type CrdtConflict = {
  conflictId: string;
  itemId: string;
  itemName: string;
  localQuantity: number;
  remoteQuantity: number;
  localClock: VectorClockMap;
  remoteClock: VectorClockMap;
  remoteDeviceId: string;
  detectedAtMs: number;
  resolvedAtMs?: number;
  resolutionChoice?: 'local' | 'remote' | 'merge';
  resolvedQuantity?: number;
};

export type ItemMergeResult =
  | { outcome: 'local_wins' | 'remote_wins'; item: SupplyItem }
  | {
      outcome: 'conflict';
      item: SupplyItem;
      conflict: Omit<
        CrdtConflict,
        'resolvedAtMs' | 'resolutionChoice' | 'resolvedQuantity'
      >;
    };

/**
 * Tick the vector clock for the given actor and apply a new quantity.
 * This is called on every local mutation (LWW-Register write).
 */
export function tickItem(
  item: SupplyItem,
  actorId: string,
  newQuantity: number,
): SupplyItem {
  return {
    ...item,
    quantity: Math.max(0, newQuantity),
    vectorClock: tickVectorClock(item.vectorClock, actorId),
    updatedAtMs: Date.now(),
  };
}

/**
 * Merge a remote item version into the local copy.
 *
 * Clock comparison determines the outcome:
 * - local after remote  → local_wins  (keep local, discard remote)
 * - local before remote → remote_wins (adopt remote value, merge clocks)
 * - concurrent          → conflict    (both changed independently; needs user resolution)
 * - equal               → local_wins  (already in sync)
 */
export function mergeItem(
  local: SupplyItem,
  remote: SupplyItem,
  conflictId: string,
  remoteDeviceId: string,
): ItemMergeResult {
  const relation = compareVectorClocks(local.vectorClock, remote.vectorClock);

  if (relation === 'equal' || relation === 'after') {
    return { outcome: 'local_wins', item: local };
  }

  if (relation === 'before') {
    return {
      outcome: 'remote_wins',
      item: {
        ...local,
        quantity: remote.quantity,
        vectorClock: mergeVectorClocks(local.vectorClock, remote.vectorClock),
        updatedAtMs: Date.now(),
      },
    };
  }

  // Concurrent writes — genuine conflict
  return {
    outcome: 'conflict',
    item: local,
    conflict: {
      conflictId,
      itemId: local.itemId,
      itemName: local.name,
      localQuantity: local.quantity,
      remoteQuantity: remote.quantity,
      localClock: local.vectorClock,
      remoteClock: remote.vectorClock,
      remoteDeviceId,
      detectedAtMs: Date.now(),
    },
  };
}

/**
 * Resolve a conflict by picking one side or merging (floor-average), and
 * merging the vector clocks in all cases to advance causal history.
 */
export function resolveConflictMerge(
  conflict: CrdtConflict,
  choice: 'local' | 'remote' | 'merge',
): { resolvedQuantity: number; mergedClock: VectorClockMap } {
  let resolvedQuantity: number;
  if (choice === 'local') {
    resolvedQuantity = conflict.localQuantity;
  } else if (choice === 'remote') {
    resolvedQuantity = conflict.remoteQuantity;
  } else {
    // merge = floor((local + remote) / 2)
    resolvedQuantity = Math.floor(
      (conflict.localQuantity + conflict.remoteQuantity) / 2,
    );
  }
  return {
    resolvedQuantity,
    mergedClock: mergeVectorClocks(conflict.localClock, conflict.remoteClock),
  };
}
