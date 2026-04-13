import { getDatabase } from '../db';
import { bytesToHex, randomBytes } from '../core/auth/crypto';
import {
  type SupplyItem,
  type CrdtConflict,
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

export type { SupplyItem, CrdtConflict };

export type SyncResult = {
  remoteDeviceId: string;
  localWins: number;
  remoteWins: number;
  conflicts: number;
  newItems: number;
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
        ? (row.resolution_choice as 'local' | 'remote')
        : undefined,
    resolvedQuantity:
      row.resolved_quantity != null
        ? (row.resolved_quantity as number)
        : undefined,
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
}

// ── CRDT Sync Simulation ────────────────────────────────────────────────
// Simulates receiving a delta from a remote device. In a real deployment
// this payload would arrive over Bluetooth/Wi-Fi Direct as a Protobuf message.
// The merge logic is identical regardless of transport.

export async function simulateSyncFromDevice(): Promise<SyncResult> {
  const db = await getDatabase();
  const remoteDeviceId = genId('REMOTE-');

  const items = await getInventory();
  let localWins = 0;
  let remoteWins = 0;
  let conflicts = 0;
  let newItems = 0;

  // --- Merge existing items ---
  // We cycle through three scenarios to demonstrate all CRDT outcomes:
  //   index % 3 == 0  →  concurrent clocks → CONFLICT
  //   index % 3 == 1  →  remote strictly ahead → remote_wins
  //   index % 3 == 2  →  local strictly ahead / remote empty → local_wins
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const deltaQty = i % 3 === 0 ? -5 : i % 3 === 1 ? 12 : 3;
    const remoteQty = Math.max(0, item.quantity + deltaQty);

    let remoteClock: VectorClockMap;
    if (i % 3 === 0 && Object.keys(item.vectorClock).length > 0) {
      // concurrent: remote has an independent entry the local hasn't seen
      remoteClock = tickVectorClock({}, remoteDeviceId);
    } else if (i % 3 === 1) {
      // remote strictly ahead: bump every local actor by 1 and add remote
      const ahead: VectorClockMap = {};
      for (const [k, v] of Object.entries(item.vectorClock)) {
        ahead[k] = v + 1;
      }
      ahead[remoteDeviceId] = 1;
      remoteClock = ahead;
    } else {
      // local strictly ahead: remote has an empty / older clock
      remoteClock = {};
    }

    const remoteVersion: SupplyItem = {
      ...item,
      quantity: remoteQty,
      vectorClock: remoteClock,
    };

    const conflictId = genId('CONF-');
    const result = mergeItem(item, remoteVersion, conflictId, remoteDeviceId);

    if (result.outcome === 'conflict') {
      await db.execute(
        `INSERT INTO crdt_conflicts
         (conflict_id, item_id, item_name, local_quantity, remote_quantity,
          local_clock_json, remote_clock_json, remote_device_id, detected_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.conflict.conflictId,
          result.conflict.itemId,
          result.conflict.itemName,
          result.conflict.localQuantity,
          result.conflict.remoteQuantity,
          serializeVectorClock(result.conflict.localClock),
          serializeVectorClock(result.conflict.remoteClock),
          result.conflict.remoteDeviceId,
          result.conflict.detectedAtMs,
        ],
      );
      conflicts++;
    } else if (result.outcome === 'remote_wins') {
      const u = result.item;
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

  return { remoteDeviceId, localWins, remoteWins, conflicts, newItems };
}

export async function resolveConflict(
  conflictId: string,
  choice: 'local' | 'remote',
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
}
