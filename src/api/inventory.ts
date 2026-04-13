import { getDatabase } from '../db';
import { bytesToHex, randomBytes } from '../core/auth/crypto';
import {
  type SupplyItem,
  type CrdtConflict,
  type MutationHistoryEntry,
  tickItem,
  mergeItem,
  resolveConflictMerge,
} from '../core/crdt/inventory';
import {
  type VectorClockMap,
  tickVectorClock,
  deserializeVectorClock,
  serializeVectorClock,
} from '../core/crdt/vectorClock';
import { createSQLiteLedgerService } from '../core/auth/ledger-service';
import { getBleSyncService } from '../core/mesh/ble-sync';

export type { SupplyItem, CrdtConflict, MutationHistoryEntry };

export type SyncResult = {
  remoteDeviceId: string;
  localWins: number;
  remoteWins: number;
  conflicts: number;
  newItems: number;
  transport: 'ble' | 'simulation';
  /** Set when BLE was attempted but failed (no peer found or error). */
  bleStatus: 'success' | 'no_peer' | 'error' | 'simulation_only';
  bleError?: string;
};

function genId(prefix: string): string {
  return `${prefix}${bytesToHex(randomBytes(4)).toUpperCase()}`;
}

function rowToItem(row: Record<string, unknown>): SupplyItem {
  return {
    itemId: row.inventory_item_id as string,
    sku: row.sku as string,
    name: row.item_name as string,
    category: row.category as string,
    quantity: row.quantity as number,
    unit: row.unit as string,
    nodeId: row.storage_node_id as string,
    vectorClock: deserializeVectorClock(row.vector_clock_json as string | null),
    updatedAtMs: row.updated_at_ms as number,
  };
}

function rowToConflict(row: Record<string, unknown>): CrdtConflict {
  return {
    conflictId: row.conflict_id as string,
    itemId: row.item_id as string,
    itemName: row.item_name as string,
    localQuantity: row.local_quantity as number,
    remoteQuantity: row.remote_quantity as number,
    localClock: deserializeVectorClock(row.local_clock_json as string | null),
    remoteClock: deserializeVectorClock(row.remote_clock_json as string | null),
    remoteDeviceId: row.remote_device_id as string,
    detectedAtMs: row.detected_at_ms as number,
    resolvedAtMs:
      row.resolved_at_ms != null ? (row.resolved_at_ms as number) : undefined,
    resolutionChoice:
      row.resolution_choice != null
        ? (row.resolution_choice as 'local' | 'remote' | 'merge')
        : undefined,
    resolvedQuantity:
      row.resolved_quantity != null
        ? (row.resolved_quantity as number)
        : undefined,
  };
}

function rowToMutation(row: Record<string, unknown>): MutationHistoryEntry {
  return {
    mutationId: row.mutation_id as string,
    itemId: row.item_id as string,
    actorDeviceId: row.actor_device_id as string,
    eventType: row.event_type as 'create' | 'update' | 'delete',
    oldQuantity:
      row.old_quantity != null ? (row.old_quantity as number) : undefined,
    newQuantity: row.new_quantity as number,
    vectorClock: deserializeVectorClock(row.vector_clock_json as string | null),
    previousMutationId:
      row.previous_mutation_id != null
        ? (row.previous_mutation_id as string)
        : undefined,
    occurredAtMs: row.occurred_at_ms as number,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────

export async function getInventory(): Promise<SupplyItem[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM supply_inventory WHERE status != 'deleted' ORDER BY updated_at_ms DESC`,
  );
  return result.rows.map(r => rowToItem(r as Record<string, unknown>));
}

export async function getConflicts(): Promise<CrdtConflict[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM crdt_conflicts WHERE resolved_at_ms IS NULL ORDER BY detected_at_ms DESC`,
  );
  return result.rows.map(r => rowToConflict(r as Record<string, unknown>));
}

export async function getInventoryStats(): Promise<{
  totalItems: number;
  pendingConflicts: number;
}> {
  const db = await getDatabase();
  const items = await db.execute(
    `SELECT COUNT(*) as c FROM supply_inventory WHERE status != 'deleted'`,
  );
  const conflicts = await db.execute(
    `SELECT COUNT(*) as c FROM crdt_conflicts WHERE resolved_at_ms IS NULL`,
  );
  return {
    totalItems: ((items.rows[0] as Record<string, unknown>)?.c as number) ?? 0,
    pendingConflicts:
      ((conflicts.rows[0] as Record<string, unknown>)?.c as number) ?? 0,
  };
}

/**
 * M2.2 – Return the causal mutation history for a single item in
 * chronological order so the UI can show the A→B→C chain.
 */
export async function getMutationHistory(
  itemId: string,
): Promise<MutationHistoryEntry[]> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM mutation_history
     WHERE item_id = ?
     ORDER BY occurred_at_ms ASC`,
    [itemId],
  );
  return result.rows.map(r => rowToMutation(r as Record<string, unknown>));
}

// ── Private helper: write one mutation_history row ─────────────────────

async function writeMutationHistory(entry: {
  itemId: string;
  actorDeviceId: string;
  eventType: 'create' | 'update' | 'delete';
  oldQuantity?: number;
  newQuantity: number;
  vectorClock: VectorClockMap;
}): Promise<string> {
  const db = await getDatabase();

  // Find the most recent mutation_id for this item to link causally
  const prevResult = await db.execute(
    `SELECT mutation_id FROM mutation_history
     WHERE item_id = ?
     ORDER BY occurred_at_ms DESC
     LIMIT 1`,
    [entry.itemId],
  );
  const previousMutationId =
    prevResult.rows.length > 0
      ? String((prevResult.rows[0] as Record<string, unknown>).mutation_id)
      : undefined;

  const mutationId = genId('MUT-');
  const nowMs = Date.now();

  await db.execute(
    `INSERT INTO mutation_history
       (mutation_id, item_id, actor_device_id, event_type,
        old_quantity, new_quantity, vector_clock_json,
        previous_mutation_id, occurred_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mutationId,
      entry.itemId,
      entry.actorDeviceId,
      entry.eventType,
      entry.oldQuantity ?? null,
      entry.newQuantity,
      serializeVectorClock(entry.vectorClock),
      previousMutationId ?? null,
      nowMs,
    ],
  );

  return mutationId;
}

// ── Writes ─────────────────────────────────────────────────────────────

export async function addInventoryItem(input: {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  actorDeviceId: string;
}): Promise<SupplyItem> {
  const db = await getDatabase();
  const itemId = genId('ITEM-');
  const nowMs = Date.now();
  const clock: VectorClockMap = tickVectorClock({}, input.actorDeviceId);

  await db.execute(
    `INSERT INTO supply_inventory
     (inventory_item_id, sku, item_name, category, quantity, unit,
      storage_node_id, status, vector_clock_json, updated_at_ms, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'LOCAL', 'available', ?, ?, '{}')`,
    [
      itemId,
      itemId,
      input.name.trim(),
      input.category,
      input.quantity,
      input.unit,
      serializeVectorClock(clock),
      nowMs,
    ],
  );

  // M2.1 – write an OR-Set "add" tag so the item survives concurrent removes
  const tagId = genId('TAG-');
  await db.execute(
    `INSERT INTO or_set_tags
       (tag_id, item_id, actor_device_id, added_at_ms)
     VALUES (?, ?, ?, ?)`,
    [tagId, itemId, input.actorDeviceId, nowMs],
  );

  // M2.2 – record causal history
  await writeMutationHistory({
    itemId,
    actorDeviceId: input.actorDeviceId,
    eventType: 'create',
    newQuantity: input.quantity,
    vectorClock: clock,
  });

  return {
    itemId,
    sku: itemId,
    name: input.name.trim(),
    category: input.category,
    quantity: input.quantity,
    unit: input.unit,
    nodeId: 'LOCAL',
    vectorClock: clock,
    updatedAtMs: nowMs,
  };
}

export async function updateItemQuantity(
  itemId: string,
  newQuantity: number,
  actorDeviceId: string,
): Promise<void> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM supply_inventory WHERE inventory_item_id = ?`,
    [itemId],
  );
  if (result.rows.length === 0) {
    return;
  }
  const item = rowToItem(result.rows[0] as Record<string, unknown>);
  const updated = tickItem(item, actorDeviceId, newQuantity);

  await db.execute(
    `UPDATE supply_inventory
     SET quantity = ?, vector_clock_json = ?, updated_at_ms = ?
     WHERE inventory_item_id = ?`,
    [
      updated.quantity,
      serializeVectorClock(updated.vectorClock),
      updated.updatedAtMs,
      itemId,
    ],
  );

  // M2.2 – record causal history for this mutation
  await writeMutationHistory({
    itemId,
    actorDeviceId,
    eventType: 'update',
    oldQuantity: item.quantity,
    newQuantity: updated.quantity,
    vectorClock: updated.vectorClock,
  });
}

// ── Conflict Resolution ─────────────────────────────────────────────────

/**
 * M2.3 – Resolve a conflict with three choices:
 *   'local'  – keep this device's value
 *   'remote' – accept the remote value
 *   'merge'  – floor-average of both quantities
 *
 * The resolution is written to crdt_conflicts, supply_inventory, and
 * the ledger (audit trail) for full provenance.
 */
export async function resolveConflict(
  conflictId: string,
  choice: 'local' | 'remote' | 'merge',
): Promise<void> {
  const db = await getDatabase();
  const result = await db.execute(
    `SELECT * FROM crdt_conflicts WHERE conflict_id = ?`,
    [conflictId],
  );
  if (result.rows.length === 0) {
    return;
  }
  const conflict = rowToConflict(result.rows[0] as Record<string, unknown>);
  const { resolvedQuantity, mergedClock } = resolveConflictMerge(
    conflict,
    choice,
  );
  const nowMs = Date.now();

  await db.execute(
    `UPDATE crdt_conflicts
     SET resolved_at_ms = ?, resolution_choice = ?, resolved_quantity = ?
     WHERE conflict_id = ?`,
    [nowMs, choice, resolvedQuantity, conflictId],
  );

  await db.execute(
    `UPDATE supply_inventory
     SET quantity = ?, vector_clock_json = ?, updated_at_ms = ?
     WHERE inventory_item_id = ?`,
    [
      resolvedQuantity,
      serializeVectorClock(mergedClock),
      nowMs,
      conflict.itemId,
    ],
  );

  // M2.2 – record the resolution as a causal mutation
  await writeMutationHistory({
    itemId: conflict.itemId,
    actorDeviceId: 'RESOLUTION',
    eventType: 'update',
    oldQuantity: conflict.localQuantity,
    newQuantity: resolvedQuantity,
    vectorClock: mergedClock,
  });

  // M2.3 – append to ledger audit trail (conflict_resolved event)
  try {
    const ledger = createSQLiteLedgerService();
    await ledger.appendEvent({
      eventId: genId('EVT-'),
      entityType: 'supply_item',
      entityId: conflict.itemId,
      eventType: 'conflict_resolved',
      actor: {
        userId: '',
        deviceId: conflict.remoteDeviceId,
        role: 'SYNC_ADMIN',
      },
      occurredAtMs: nowMs,
      vectorClock: mergedClock,
      payloadType: 'digitaldelta.v1.conflict_resolved',
      metadata: {
        conflictId,
        choice,
        resolvedQuantity,
        localQuantity: conflict.localQuantity,
        remoteQuantity: conflict.remoteQuantity,
      },
    });
  } catch {
    // ledger write failure must never block the UI
  }
}

// ── Delta-Sync (BLE-first, simulated fallback) ──────────────────────────

/**
 * M2.4 – Attempt a real BLE delta-sync; falls back to a local simulation
 * if no peer is reachable. Serialises the delta as a Protobuf SyncDelta
 * (≤ 10 KB) using the vector clock as the cursor.
 *
 * BLE transport: react-native-ble-plx (central role).
 * Peripheral-side GATT server requires a native module (see ble-sync.ts).
 */
export async function simulateSyncFromDevice(): Promise<SyncResult> {
  // Try BLE first ─────────────────────────────────────────────────────
  let bleError: string | undefined;
  let bleStatus: SyncResult['bleStatus'] = 'no_peer';

  try {
    const ble = getBleSyncService();
    const bleResult = await ble.syncWithNearbyPeer();
    if (bleResult) {
      return { ...bleResult, transport: 'ble', bleStatus: 'success' };
    }
    // syncWithNearbyPeer returned null = scan timed out, no peer found
    bleStatus = 'no_peer';
    bleError = `No DigitalDelta peer found within 8 s. Make sure the other device has tapped "Start Advertising" on the Mesh tab.`;
  } catch (err) {
    bleStatus = 'error';
    bleError = err instanceof Error ? err.message : String(err);
  }

  // Simulation fallback ───────────────────────────────────────────────
  const sim = await _simulateSyncLocally();
  return { ...sim, bleStatus, bleError };
}

async function _simulateSyncLocally(): Promise<SyncResult> {
  const db = await getDatabase();
  const remoteDeviceId = genId('REMOTE-');

  const items = await getInventory();
  let localWins = 0;
  let remoteWins = 0;
  let conflicts = 0;
  const newItems = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const deltaQty = i % 3 === 0 ? -5 : i % 3 === 1 ? 12 : 3;
    const remoteQty = Math.max(0, item.quantity + deltaQty);

    let remoteClock: VectorClockMap;
    if (i % 3 === 0 && Object.keys(item.vectorClock).length > 0) {
      remoteClock = tickVectorClock({}, remoteDeviceId);
    } else if (i % 3 === 1) {
      const ahead: VectorClockMap = {};
      for (const [k, v] of Object.entries(item.vectorClock)) {
        ahead[k] = v + 1;
      }
      ahead[remoteDeviceId] = 1;
      remoteClock = ahead;
    } else {
      remoteClock = {};
    }

    const remoteVersion: SupplyItem = {
      ...item,
      quantity: remoteQty,
      vectorClock: remoteClock,
    };

    const conflictId = genId('CONF-');
    const mergeResult = mergeItem(
      item,
      remoteVersion,
      conflictId,
      remoteDeviceId,
    );

    if (mergeResult.outcome === 'conflict') {
      await db.execute(
        `INSERT INTO crdt_conflicts
         (conflict_id, item_id, item_name, local_quantity, remote_quantity,
          local_clock_json, remote_clock_json, remote_device_id, detected_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mergeResult.conflict.conflictId,
          mergeResult.conflict.itemId,
          mergeResult.conflict.itemName,
          mergeResult.conflict.localQuantity,
          mergeResult.conflict.remoteQuantity,
          serializeVectorClock(mergeResult.conflict.localClock),
          serializeVectorClock(mergeResult.conflict.remoteClock),
          mergeResult.conflict.remoteDeviceId,
          mergeResult.conflict.detectedAtMs,
        ],
      );
      conflicts++;
    } else if (mergeResult.outcome === 'remote_wins') {
      const u = mergeResult.item;
      await db.execute(
        `UPDATE supply_inventory
         SET quantity = ?, vector_clock_json = ?, updated_at_ms = ?
         WHERE inventory_item_id = ?`,
        [
          u.quantity,
          serializeVectorClock(u.vectorClock),
          u.updatedAtMs,
          item.itemId,
        ],
      );
      remoteWins++;
    } else {
      localWins++;
    }
  }

  return {
    remoteDeviceId,
    localWins,
    remoteWins,
    conflicts,
    newItems,
    transport: 'simulation',
    bleStatus: 'simulation_only' as const,
  };
}
