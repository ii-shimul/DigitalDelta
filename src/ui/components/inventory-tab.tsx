import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { RegisteredUser } from '../../api/auth';
import {
  type CrdtConflict,
  type MutationHistoryEntry,
  type SupplyItem,
  type SyncResult,
  addInventoryItem,
  getConflicts,
  getInventory,
  getMutationHistory,
  resolveConflict,
  simulateSyncFromDevice,
  updateItemQuantity,
} from '../../api/inventory';
import { Colors, CATEGORY_COLOR, Spacing, Radii, Typography } from '../theme';

const CATEGORIES = ['Medical', 'Food', 'Water', 'Shelter', 'Equipment'];
const UNITS = ['pcs', 'kg', 'L', 'boxes', 'kits', 'cans'];

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
  const [scanCountdown, setScanCountdown] = useState<number | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Add-item form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Medical');
  const [newQuantity, setNewQuantity] = useState('');
  const [newUnit, setNewUnit] = useState('pcs');

  const canWrite = CAN_WRITE[user.role] ?? false;
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MutationHistoryEntry[]>(
    [],
  );
  const historyFadeAnim = useRef(new Animated.Value(0)).current;

  const loadData = useCallback(async () => {
    const [inv, conf] = await Promise.all([getInventory(), getConflicts()]);
    setItems(inv);
    setConflicts(conf);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleShowHistory = useCallback(
    async (itemId: string) => {
      if (historyItemId === itemId) {
        setHistoryItemId(null);
        setHistoryEntries([]);
        return;
      }
      const entries = await getMutationHistory(itemId);
      setHistoryEntries(entries);
      setHistoryItemId(itemId);
      historyFadeAnim.setValue(0);
      Animated.timing(historyFadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    },
    [historyItemId, historyFadeAnim],
  );

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
        'Add some items first, then simulate sync to demonstrate CRDT merging.',
      );
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    // Start 8-second BLE scan countdown
    setScanCountdown(8);
    scanTimerRef.current = setInterval(() => {
      setScanCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (scanTimerRef.current) clearInterval(scanTimerRef.current);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
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
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      setScanCountdown(null);
      setSyncing(false);
    }
  }, [items.length, loadData]);

  const handleResolve = useCallback(
    async (conflict: CrdtConflict, choice: 'local' | 'remote' | 'merge') => {
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
                Remote: {c.remoteDeviceId}
              </Text>
              {/* M2.3 – side-by-side values */}
              <View style={styles.conflictValues}>
                <TouchableOpacity
                  style={styles.conflictOption}
                  onPress={() => handleResolve(c, 'local')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.conflictOptionLabel}>Mine</Text>
                  <Text style={styles.conflictOptionValue}>
                    {c.localQuantity}
                  </Text>
                  <Text style={styles.conflictOptionClock}>
                    {JSON.stringify(c.localClock)}
                  </Text>
                  <Text style={styles.conflictKeep}>Keep Mine</Text>
                </TouchableOpacity>

                <View style={styles.conflictVs}>
                  <Text style={styles.conflictVsText}>vs</Text>
                </View>

                <TouchableOpacity
                  style={styles.conflictOption}
                  onPress={() => handleResolve(c, 'remote')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.conflictOptionLabel}>Theirs</Text>
                  <Text style={styles.conflictOptionValue}>
                    {c.remoteQuantity}
                  </Text>
                  <Text style={styles.conflictOptionClock}>
                    {JSON.stringify(c.remoteClock)}
                  </Text>
                  <Text style={styles.conflictKeep}>Keep Theirs</Text>
                </TouchableOpacity>
              </View>

              {/* M2.3 – Merge button (floor-average) */}
              <TouchableOpacity
                style={styles.btnMerge}
                onPress={() => handleResolve(c, 'merge')}
                activeOpacity={0.8}
              >
                <Text style={styles.btnMergeText}>
                  Merge — avg:{' '}
                  {Math.floor((c.localQuantity + c.remoteQuantity) / 2)}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Last sync result */}
      {syncResult && (
        <View style={styles.syncResultCard}>
          <View style={styles.syncResultTitleRow}>
            <Text style={styles.syncResultTitle}>Sync Complete</Text>
            <View
              style={[
                styles.transportBadge,
                syncResult.transport === 'ble'
                  ? styles.transportBle
                  : styles.transportSim,
              ]}
            >
              <Text style={styles.transportBadgeText}>
                {syncResult.transport === 'ble' ? 'BLE' : 'Simulated'}
              </Text>
            </View>
          </View>
          <Text style={styles.syncResultText}>
            Remote: {syncResult.remoteDeviceId}
          </Text>
          <View style={styles.syncResultRow}>
            <SyncBadge
              label="Local Wins"
              value={syncResult.localWins}
              color={Colors.verified}
            />
            <SyncBadge
              label="Remote Wins"
              value={syncResult.remoteWins}
              color={Colors.tealLight}
            />
            <SyncBadge
              label="Conflicts"
              value={syncResult.conflicts}
              color={Colors.orange}
            />
            {syncResult.newItems > 0 && (
              <SyncBadge
                label="New Items"
                value={syncResult.newItems}
                color={Colors.catEquipment}
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
              Tap "＋ Add Item" above to register supply inventory.
            </Text>
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

                  {/* M2.2 – Causal history drill-down */}
                  <TouchableOpacity
                    style={styles.historyToggleBtn}
                    onPress={() => handleShowHistory(item.itemId)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.historyToggleText}>
                      {historyItemId === item.itemId
                        ? 'Hide history'
                        : 'Show causal history'}
                    </Text>
                  </TouchableOpacity>

                  {historyItemId === item.itemId && (
                    <Animated.View
                      style={[
                        styles.historySection,
                        { opacity: historyFadeAnim },
                      ]}
                    >
                      {historyEntries.length === 0 ? (
                        <Text style={styles.historyEmpty}>
                          No history recorded yet.
                        </Text>
                      ) : (
                        historyEntries.map((entry, idx) => (
                          <View
                            key={entry.mutationId}
                            style={styles.historyRow}
                          >
                            <View style={styles.historyLine}>
                              <View
                                style={[
                                  styles.historyDot,
                                  idx === historyEntries.length - 1 &&
                                    styles.historyDotLatest,
                                ]}
                              />
                              {idx < historyEntries.length - 1 && (
                                <View style={styles.historyConnector} />
                              )}
                            </View>
                            <View style={styles.historyContent}>
                              <Text style={styles.historyActor}>
                                {entry.actorDeviceId.slice(-8)}
                              </Text>
                              <Text style={styles.historyQty}>
                                {entry.oldQuantity != null
                                  ? `${entry.oldQuantity} → `
                                  : ''}
                                {entry.newQuantity}
                              </Text>
                              <Text style={styles.historyTime}>
                                {new Date(
                                  entry.occurredAtMs,
                                ).toLocaleTimeString()}
                              </Text>
                            </View>
                          </View>
                        ))
                      )}
                    </Animated.View>
                  )}
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
            {scanCountdown !== null
              ? `📡 Scanning for BLE peer… ${scanCountdown}s`
              : syncing
              ? '⏳ Applying CRDT delta…'
              : '⟳ Sync with Remote Device (BLE)'}
          </Text>
        </TouchableOpacity>

        {/* BLE status banner – shown after sync attempt */}
        {syncResult && (
          <View
            style={[
              styles.bleSyncBanner,
              syncResult.bleStatus === 'success'
                ? styles.bleBannerSuccess
                : syncResult.bleStatus === 'error'
                ? styles.bleBannerError
                : styles.bleBannerWarn,
            ]}
          >
            <Text style={styles.bleSyncBannerText}>
              {syncResult.bleStatus === 'success'
                ? '📶 BLE sync completed with real device'
                : syncResult.bleStatus === 'error'
                ? `⚠️ BLE error — ${syncResult.bleError ?? 'unknown'}`
                : syncResult.bleStatus === 'no_peer'
                ? `📵 No BLE peer found — Make sure the other phone tapped "Start Advertising" on the Mesh tab.`
                : '🧙 Simulation only (no BLE attempted)'}
            </Text>
          </View>
        )}
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
    marginBottom: Spacing.lg,
  },
  heroEyebrow: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightSemibold,
    letterSpacing: 2,
    color: Colors.tealMid,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: Spacing.lg,
  },
  statBadge: {
    flex: 1,
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statBadgeWarn: {
    borderColor: Colors.borderWarn,
    backgroundColor: Colors.conflictFaint,
  },
  statNum: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
  },
  statNumWarn: {
    color: Colors.orange,
  },
  statLbl: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statLblWarn: {
    color: Colors.orange,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  sectionSub: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    marginBottom: 10,
    lineHeight: 17,
  },
  emptyCard: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyText: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  emptyHint: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  itemCard: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemCardConflict: {
    borderColor: Colors.orange,
    backgroundColor: Colors.conflictFaint,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 6,
  },
  catBadge: {
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  catText: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightBold,
  },
  conflictBadge: {
    backgroundColor: Colors.conflictFaint,
    borderRadius: Radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  conflictBadgeText: {
    fontSize: Typography.fontSizeXs,
    color: Colors.orange,
    fontWeight: Typography.fontWeightBold,
    letterSpacing: 0.5,
  },
  itemName: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  itemQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    backgroundColor: Colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: Typography.fontWeightBold,
    lineHeight: 20,
  },
  qtyValue: {
    fontSize: 17,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    minWidth: 60,
    textAlign: 'center',
  },
  clockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  clockLabel: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  clockEntry: {
    fontSize: Typography.fontSizeXs,
    color: Colors.tealLight,
    fontFamily: 'monospace',
    backgroundColor: Colors.tealFaint,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  historyToggleBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  historyToggleText: {
    fontSize: Typography.fontSizeXs,
    color: Colors.tealMid,
    fontWeight: Typography.fontWeightSemibold,
    textDecorationLine: 'underline',
  },
  historySection: {
    marginTop: Spacing.sm,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: Colors.tealFaint,
  },
  historyEmpty: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 6,
  },
  historyLine: {
    alignItems: 'center',
    width: 14,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.tealMid,
    marginTop: 3,
  },
  historyDotLatest: {
    backgroundColor: Colors.tealLight,
  },
  historyConnector: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.tealFaint,
    marginTop: 2,
  },
  historyContent: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  historyActor: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    flex: 1,
  },
  historyQty: {
    fontSize: Typography.fontSizeXs,
    color: Colors.tealLight,
    fontWeight: Typography.fontWeightSemibold,
    fontFamily: 'monospace',
  },
  historyTime: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  conflictCard: {
    backgroundColor: Colors.conflictFaint,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderWarn,
  },
  conflictName: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  conflictMeta: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginBottom: Spacing.md,
  },
  conflictValues: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  conflictOption: {
    flex: 1,
    backgroundColor: Colors.bgGlassElevated,
    borderRadius: Radii.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 4,
  },
  conflictOptionLabel: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conflictOptionValue: {
    fontSize: 22,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  conflictOptionClock: {
    fontSize: 9,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  conflictKeep: {
    fontSize: Typography.fontSizeSm,
    color: Colors.tealLight,
    fontWeight: Typography.fontWeightBold,
  },
  conflictVs: {
    paddingHorizontal: 6,
  },
  conflictVsText: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textMuted,
  },
  btnMerge: {
    backgroundColor: Colors.orangeFaint,
    borderRadius: Radii.md,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderWarn,
    marginTop: 2,
  },
  btnMergeText: {
    fontSize: Typography.fontSizeSm,
    color: Colors.orangeLight,
    fontWeight: Typography.fontWeightBold,
  },
  syncResultCard: {
    backgroundColor: Colors.verifiedFaint,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(46, 204, 113, 0.35)',
  },
  syncResultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  syncResultTitle: {
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
    color: Colors.verified,
  },
  transportBadge: {
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  transportBle: {
    backgroundColor: Colors.syncingFaint,
    borderWidth: 1,
    borderColor: Colors.borderFocus,
  },
  transportSim: {
    backgroundColor: Colors.bgGlass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  transportBadgeText: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
  },
  bleSyncBanner: {
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  bleBannerSuccess: {
    backgroundColor: 'rgba(56,161,105,0.15)',
    borderColor: '#38a169',
  },
  bleBannerError: {
    backgroundColor: 'rgba(229,62,62,0.15)',
    borderColor: '#e53e3e',
  },
  bleBannerWarn: {
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderColor: Colors.orange,
  },
  bleSyncBannerText: {
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  syncResultText: {
    fontSize: Typography.fontSizeXs,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  syncResultRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  syncBadge: {
    borderRadius: Radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 64,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  syncBadgeNum: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
  },
  syncBadgeLbl: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightSemibold,
  },
  actions: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  btnPrimary: {
    backgroundColor: Colors.teal,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: Colors.white,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
  },
  btnSecondary: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderFocus,
  },
  btnSecondaryText: {
    color: Colors.tealLight,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemibold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  addForm: {
    backgroundColor: Colors.bgGlassElevated,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formLabel: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formInput: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: Spacing.md,
    fontSize: Typography.fontSizeLg,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.borderFocus,
  },
  formRow: {
    flexDirection: 'row',
    gap: Spacing.md,
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
    borderRadius: Radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.tealFaint,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: {
    backgroundColor: Colors.teal,
    borderColor: Colors.tealLight,
  },
  chipText: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.tealLight,
  },
  chipTextSelected: {
    color: Colors.white,
  },
});
