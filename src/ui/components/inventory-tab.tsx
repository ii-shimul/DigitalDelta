import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { RegisteredUser } from '../../api/auth';
import {
  type CrdtConflict,
  type SupplyItem,
  type SyncResult,
  addInventoryItem,
  getConflicts,
  getInventory,
  resolveConflict,
  seedDemoInventory,
  simulateSyncFromDevice,
  updateItemQuantity,
} from '../../api/inventory';

const CATEGORIES = ['Medical', 'Food', 'Water', 'Shelter', 'Equipment'];
const UNITS = ['pcs', 'kg', 'L', 'boxes', 'kits', 'cans'];

const CATEGORY_COLOR: Record<string, string> = {
  Medical: '#e53e3e',
  Food: '#d69e2e',
  Water: '#3182ce',
  Shelter: '#38a169',
  Equipment: '#805ad5',
};

const CAN_WRITE: Record<string, boolean> = {
  SUPPLY_MANAGER: true,
  CAMP_COMMANDER: true,
  SYNC_ADMIN: true,
  FIELD_VOLUNTEER: false,
  DRONE_OPERATOR: false,
};

type Props = {
  user: RegisteredUser;
};

export function InventoryTab({ user }: Props) {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [conflicts, setConflicts] = useState<CrdtConflict[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Add-item form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Medical');
  const [newQuantity, setNewQuantity] = useState('');
  const [newUnit, setNewUnit] = useState('pcs');

  const canWrite = CAN_WRITE[user.role] ?? false;

  const loadData = useCallback(async () => {
    const [inv, conf] = await Promise.all([getInventory(), getConflicts()]);
    setItems(inv);
    setConflicts(conf);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSeedDemo = useCallback(async () => {
    await seedDemoInventory(user.deviceId);
    await loadData();
  }, [user.deviceId, loadData]);

  const handleAddItem = useCallback(async () => {
    const qty = parseInt(newQuantity, 10);
    if (!newName.trim() || isNaN(qty) || qty < 0) {
      Alert.alert('Invalid Input', 'Enter a valid name and quantity.');
      return;
    }
    await addInventoryItem({
      name: newName.trim(),
      category: newCategory,
      quantity: qty,
      unit: newUnit,
      actorDeviceId: user.deviceId,
    });
    setNewName('');
    setNewQuantity('');
    setNewCategory('Medical');
    setNewUnit('pcs');
    setShowAdd(false);
    await loadData();
  }, [newName, newCategory, newQuantity, newUnit, user.deviceId, loadData]);

  const handleDelta = useCallback(
    async (itemId: string, currentQty: number, delta: number) => {
      await updateItemQuantity(itemId, currentQty + delta, user.deviceId);
      await loadData();
    },
    [user.deviceId, loadData],
  );

  const handleSimulateSync = useCallback(async () => {
    if (items.length === 0) {
      Alert.alert(
        'No Items',
        'Add some items first (or tap "Load Demo Data"), then simulate sync to demonstrate CRDT merging.',
      );
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await simulateSyncFromDevice();
      setSyncResult(result);
      await loadData();
    } catch (e) {
      Alert.alert(
        'Sync Error',
        e instanceof Error ? e.message : 'Unknown error',
      );
    } finally {
      setSyncing(false);
    }
  }, [items.length, loadData]);

  const handleResolve = useCallback(
    async (conflict: CrdtConflict, choice: 'local' | 'remote') => {
      await resolveConflict(conflict.conflictId, choice);
      await loadData();
    },
    [loadData],
  );

  return (
    <View>
      {/* Section header */}
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>CRDT · VECTOR CLOCKS</Text>
        <Text style={styles.heroTitle}>Supply Inventory</Text>
        <Text style={styles.heroSub}>
          Offline-first LWW-Register CRDT. Every mutation carries a vector
          clock. Concurrent edits are detected and surfaced for resolution.
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statBadge}>
          <Text style={styles.statNum}>{items.length}</Text>
          <Text style={styles.statLbl}>Items</Text>
        </View>
        <View
          style={[
            styles.statBadge,
            conflicts.length > 0 && styles.statBadgeWarn,
          ]}
        >
          <Text
            style={[styles.statNum, conflicts.length > 0 && styles.statNumWarn]}
          >
            {conflicts.length}
          </Text>
          <Text
            style={[styles.statLbl, conflicts.length > 0 && styles.statLblWarn]}
          >
            Conflicts
          </Text>
        </View>
        <View style={styles.statBadge}>
          <Text style={styles.statNum}>LWW</Text>
          <Text style={styles.statLbl}>CRDT Type</Text>
        </View>
      </View>

      {/* Pending conflicts */}
      {conflicts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚠ Pending Conflicts</Text>
          <Text style={styles.sectionSub}>
            These items were updated concurrently on two devices. Choose which
            value to keep — this resolves the vector clock divergence.
          </Text>
          {conflicts.map(c => (
            <View key={c.conflictId} style={styles.conflictCard}>
              <Text style={styles.conflictName}>{c.itemName}</Text>
              <Text style={styles.conflictMeta}>
                Remote device: {c.remoteDeviceId}
              </Text>
              <View style={styles.conflictValues}>
                <TouchableOpacity
                  style={styles.conflictOption}
                  onPress={() => handleResolve(c, 'local')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.conflictOptionLabel}>Local</Text>
                  <Text style={styles.conflictOptionValue}>
                    {c.localQuantity}
                  </Text>
                  <Text style={styles.conflictOptionClock}>
                    {JSON.stringify(c.localClock)}
                  </Text>
                  <Text style={styles.conflictKeep}>Keep →</Text>
                </TouchableOpacity>

                <View style={styles.conflictVs}>
                  <Text style={styles.conflictVsText}>vs</Text>
                </View>

                <TouchableOpacity
                  style={styles.conflictOption}
                  onPress={() => handleResolve(c, 'remote')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.conflictOptionLabel}>Remote</Text>
                  <Text style={styles.conflictOptionValue}>
                    {c.remoteQuantity}
                  </Text>
                  <Text style={styles.conflictOptionClock}>
                    {JSON.stringify(c.remoteClock)}
                  </Text>
                  <Text style={styles.conflictKeep}>Keep →</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Last sync result */}
      {syncResult && (
        <View style={styles.syncResultCard}>
          <Text style={styles.syncResultTitle}>Sync Complete</Text>
          <Text style={styles.syncResultText}>
            Remote: {syncResult.remoteDeviceId}
          </Text>
          <View style={styles.syncResultRow}>
            <SyncBadge
              label="Local Wins"
              value={syncResult.localWins}
              color="#38a169"
            />
            <SyncBadge
              label="Remote Wins"
              value={syncResult.remoteWins}
              color="#3182ce"
            />
            <SyncBadge
              label="Conflicts"
              value={syncResult.conflicts}
              color="#e53e3e"
            />
            {syncResult.newItems > 0 && (
              <SyncBadge
                label="New Items"
                value={syncResult.newItems}
                color="#805ad5"
              />
            )}
          </View>
        </View>
      )}

      {/* Inventory list */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No items yet.</Text>
            <Text style={styles.emptyHint}>
              Add items manually or load demo data to see CRDT sync in action.
            </Text>
            <TouchableOpacity
              style={styles.seedBtn}
              onPress={handleSeedDemo}
              activeOpacity={0.8}
            >
              <Text style={styles.seedBtnText}>Load Demo Data</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {items.map(item => {
              const catColor =
                CATEGORY_COLOR[item.category] ?? CATEGORY_COLOR.Equipment!;
              const clockEntries = Object.entries(item.vectorClock);
              const hasConflict = conflicts.some(c => c.itemId === item.itemId);
              return (
                <View
                  key={item.itemId}
                  style={[
                    styles.itemCard,
                    hasConflict && styles.itemCardConflict,
                  ]}
                >
                  <View style={styles.itemTop}>
                    <View
                      style={[
                        styles.catBadge,
                        { backgroundColor: catColor + '22' },
                      ]}
                    >
                      <Text style={[styles.catText, { color: catColor }]}>
                        {item.category}
                      </Text>
                    </View>
                    {hasConflict && (
                      <View style={styles.conflictBadge}>
                        <Text style={styles.conflictBadgeText}>CONFLICT</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.itemName}>{item.name}</Text>

                  <View style={styles.itemQtyRow}>
                    {canWrite && (
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() =>
                          handleDelta(item.itemId, item.quantity, -1)
                        }
                        activeOpacity={0.7}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.qtyValue}>
                      {item.quantity} {item.unit}
                    </Text>
                    {canWrite && (
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() =>
                          handleDelta(item.itemId, item.quantity, 1)
                        }
                        activeOpacity={0.7}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Vector clock display (M2.2 demo) */}
                  <View style={styles.clockRow}>
                    <Text style={styles.clockLabel}>vc:</Text>
                    {clockEntries.length === 0 ? (
                      <Text style={styles.clockEntry}>{'{ }'}</Text>
                    ) : (
                      clockEntries.map(([actor, counter]) => (
                        <Text key={actor} style={styles.clockEntry}>
                          {actor.slice(-6)}:{counter}
                        </Text>
                      ))
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {canWrite && (
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => setShowAdd(!showAdd)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnPrimaryText}>
              {showAdd ? 'Cancel' : '+ Add Item'}
            </Text>
          </TouchableOpacity>
        )}

        {showAdd && canWrite && (
          <View style={styles.addForm}>
            <Text style={styles.formLabel}>Item Name</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Oral Rehydration Salts"
              placeholderTextColor="#9da3b0"
              value={newName}
              onChangeText={setNewName}
              autoCapitalize="words"
            />

            <Text style={styles.formLabel}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.chip,
                    newCategory === cat && styles.chipSelected,
                  ]}
                  onPress={() => setNewCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      newCategory === cat && styles.chipTextSelected,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <Text style={styles.formLabel}>Quantity</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="0"
                  placeholderTextColor="#9da3b0"
                  value={newQuantity}
                  onChangeText={setNewQuantity}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.formHalf}>
                <Text style={styles.formLabel}>Unit</Text>
                <View style={styles.chipRowSmall}>
                  {UNITS.map(u => (
                    <TouchableOpacity
                      key={u}
                      style={[
                        styles.chip,
                        newUnit === u && styles.chipSelected,
                      ]}
                      onPress={() => setNewUnit(u)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          newUnit === u && styles.chipTextSelected,
                        ]}
                      >
                        {u}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.btnPrimary,
                (!newName.trim() || !newQuantity) && styles.btnDisabled,
              ]}
              onPress={handleAddItem}
              disabled={!newName.trim() || !newQuantity}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>Save Item</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.btnSecondary, syncing && styles.btnDisabled]}
          onPress={handleSimulateSync}
          disabled={syncing}
          activeOpacity={0.8}
        >
          <Text style={styles.btnSecondaryText}>
            {syncing ? 'Syncing...' : '⟳ Simulate Sync from Remote Device'}
          </Text>
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>How to demo M2</Text>
          <Text style={styles.infoText}>
            {'1. Load demo data or add items manually\n' +
              '2. Use ＋/− to mutate quantities (ticks the vector clock)\n' +
              '3. Tap "Simulate Sync" — a fake remote device sends its delta\n' +
              '4. The CRDT engine classifies each item:\n' +
              '   • Local Wins: your clock is strictly ahead\n' +
              '   • Remote Wins: remote clock is strictly ahead\n' +
              '   • Conflict: concurrent edits — resolve manually above\n' +
              '5. Resolving a conflict merges the vector clocks'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SyncBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={[styles.syncBadge, { backgroundColor: color + '22' }]}>
      <Text style={[styles.syncBadgeNum, { color }]}>{value}</Text>
      <Text style={[styles.syncBadgeLbl, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginBottom: 20,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#0058be',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#131b2e',
    marginBottom: 6,
  },
  heroSub: {
    fontSize: 13,
    color: '#565e74',
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statBadge: {
    flex: 1,
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statBadgeWarn: {
    backgroundColor: '#fff3cd',
  },
  statNum: {
    fontSize: 18,
    fontWeight: '800',
    color: '#131b2e',
  },
  statNumWarn: {
    color: '#d69e2e',
  },
  statLbl: {
    fontSize: 11,
    color: '#565e74',
    marginTop: 2,
  },
  statLblWarn: {
    color: '#d69e2e',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  sectionSub: {
    fontSize: 12,
    color: '#565e74',
    marginBottom: 10,
    lineHeight: 17,
  },
  emptyCard: {
    backgroundColor: '#f2f3ff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#131b2e',
  },
  emptyHint: {
    fontSize: 13,
    color: '#565e74',
    textAlign: 'center',
    lineHeight: 18,
  },
  seedBtn: {
    marginTop: 6,
    backgroundColor: '#0058be',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  seedBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  itemCard: {
    backgroundColor: '#f8f9ff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e4e6f0',
  },
  itemCardConflict: {
    borderColor: '#e53e3e',
    backgroundColor: '#fff5f5',
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  catBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  catText: {
    fontSize: 11,
    fontWeight: '700',
  },
  conflictBadge: {
    backgroundColor: '#fff0f0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#e53e3e',
  },
  conflictBadgeText: {
    fontSize: 10,
    color: '#e53e3e',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 8,
  },
  itemQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#0058be',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  qtyValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#131b2e',
    minWidth: 60,
    textAlign: 'center',
  },
  clockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  clockLabel: {
    fontSize: 10,
    color: '#9da3b0',
    fontFamily: 'monospace',
  },
  clockEntry: {
    fontSize: 10,
    color: '#0058be',
    fontFamily: 'monospace',
    backgroundColor: '#e8ecff',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  conflictCard: {
    backgroundColor: '#fff5f5',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e53e3e',
  },
  conflictName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 2,
  },
  conflictMeta: {
    fontSize: 11,
    color: '#9da3b0',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  conflictValues: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  conflictOption: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: '#e4e6f0',
    alignItems: 'center',
    gap: 4,
  },
  conflictOptionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#565e74',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conflictOptionValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#131b2e',
  },
  conflictOptionClock: {
    fontSize: 9,
    color: '#9da3b0',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  conflictKeep: {
    fontSize: 12,
    color: '#0058be',
    fontWeight: '700',
  },
  conflictVs: {
    paddingHorizontal: 6,
  },
  conflictVsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#c2c6d6',
  },
  syncResultCard: {
    backgroundColor: '#f0fff4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#38a169',
  },
  syncResultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#276749',
    marginBottom: 4,
  },
  syncResultText: {
    fontSize: 11,
    color: '#565e74',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  syncResultRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  syncBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 64,
  },
  syncBadgeNum: {
    fontSize: 16,
    fontWeight: '800',
  },
  syncBadgeLbl: {
    fontSize: 10,
    fontWeight: '600',
  },
  actions: {
    gap: 12,
    marginBottom: 20,
  },
  btnPrimary: {
    backgroundColor: '#0058be',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: '#f2f3ff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  btnSecondaryText: {
    color: '#131b2e',
    fontSize: 14,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  addForm: {
    backgroundColor: '#f8f9ff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e4e6f0',
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#131b2e',
  },
  formInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#131b2e',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  formHalf: {
    flex: 1,
    gap: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipRowSmall: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#e8ecff',
  },
  chipSelected: {
    backgroundColor: '#0058be',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0058be',
  },
  chipTextSelected: {
    color: '#fff',
  },
  infoBox: {
    backgroundColor: '#f2f3ff',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0058be',
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 12,
    color: '#565e74',
    lineHeight: 18,
  },
});
