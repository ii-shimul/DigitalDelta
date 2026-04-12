import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { RegisteredUser } from '../../api/auth';
import {
  type DroneHandoff,
  type NodeReachability,
  type RendezvousResult,
  type ThrottleSimResult,
  DEMO_RENDEZVOUS_SCENARIOS,
  completeHandoff,
  getHandoffs,
  getReachabilityMap,
  initiateHandoff,
  resetFloodScenario,
  runBatterySimulation,
  simulateFloodScenario,
} from '../../api/fleet';

type Props = { user: RegisteredUser };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ReachabilityBadge({ node }: { node: NodeReachability }) {
  let color = '#38a169'; // green — all clear
  let label = 'REACHABLE';
  if (node.isolated) {
    color = '#e53e3e';
    label = 'ISOLATED';
  } else if (node.droneRequired) {
    color = '#d69e2e';
    label = 'DRONE ONLY';
  } else if (!node.reachableByTruck && node.reachableByBoat) {
    color = '#3182ce';
    label = 'BOAT ONLY';
  } else if (node.reachableByTruck && !node.reachableByBoat) {
    color = '#4a5568';
    label = 'TRUCK ONLY';
  }
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const NODE_TYPE_ICON: Record<string, string> = {
  depot: '🏭',
  hospital: '🏥',
  camp: '⛺',
  drone_base: '🚁',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function FleetTab({ user }: Props) {
  const [reachability, setReachability] = useState<NodeReachability[]>([]);
  const [handoffs, setHandoffs] = useState<DroneHandoff[]>([]);
  const [rendezvousResult, setRendezvousResult] =
    useState<RendezvousResult | null>(null);
  const [throttleResult, setThrottleResult] =
    useState<ThrottleSimResult | null>(null);
  const [floodActive, setFloodActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<
    'reachability' | 'rendezvous' | 'handoff' | 'battery'
  >('reachability');

  const refresh = useCallback(async () => {
    const [reach, hdfs] = await Promise.all([
      getReachabilityMap(),
      getHandoffs(),
    ]);
    setReachability(reach);
    setHandoffs(hdfs);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── M8.1 handlers ────────────────────────────────────────────────────────
  const handleFloodToggle = async () => {
    setLoading(true);
    try {
      if (floodActive) {
        await resetFloodScenario();
        setFloodActive(false);
      } else {
        await simulateFloodScenario();
        setFloodActive(true);
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  // ── M8.2 handlers ────────────────────────────────────────────────────────
  const handleRendezvous = async (idx: number) => {
    setLoading(true);
    setRendezvousResult(null);
    try {
      const result = await import('../../api/fleet').then(m =>
        m.computeDemoRendezvous(idx),
      );
      setRendezvousResult(result);
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── M8.3 handlers ────────────────────────────────────────────────────────
  const handleInitiateHandoff = async (idx: number) => {
    setLoading(true);
    try {
      const { result, handoffId } = await initiateHandoff(user, idx);
      if (!handoffId) {
        Alert.alert(
          'Handoff Failed',
          result.constraintViolation ?? 'No valid rendezvous',
        );
      } else {
        Alert.alert(
          'Handoff Initiated',
          `Rendezvous at ${result.best?.displayName}\nMeet time: ${result.best?.meetTimeMinutes} min`,
        );
      }
      await refresh();
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteHandoff = async (handoffId: string) => {
    setLoading(true);
    try {
      const { receiptId, error } = await completeHandoff(user, handoffId);
      if (error && !receiptId) {
        Alert.alert('Handoff Error', error);
      } else {
        Alert.alert(
          'Handoff Complete',
          `PoD receipt: ${receiptId}\nPayload transferred in CRDT ledger.`,
        );
      }
      await refresh();
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── M8.4 handlers ────────────────────────────────────────────────────────
  const handleBatterySim = async () => {
    setLoading(true);
    setThrottleResult(null);
    try {
      const result = await runBatterySimulation(user);
      setThrottleResult(result);
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const droneZones = reachability.filter(n => n.droneRequired || n.isolated);

  return (
    <View style={styles.container}>
      {/* Section tabs */}
      <View style={styles.sectionNav}>
        {(
          [
            ['reachability', 'M8.1 Reach'],
            ['rendezvous', 'M8.2 Rend.'],
            ['handoff', 'M8.3 Handoff'],
            ['battery', 'M8.4 Battery'],
          ] as const
        ).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[
              styles.sectionBtn,
              activeSection === key && styles.sectionBtnActive,
            ]}
            onPress={() => setActiveSection(key)}
          >
            <Text
              style={[
                styles.sectionBtnText,
                activeSection === key && styles.sectionBtnTextActive,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── M8.1: Reachability ───────────────────────────────────────── */}
        {activeSection === 'reachability' && (
          <View>
            {/* Drone-required zone summary */}
            {droneZones.length > 0 && (
              <View style={styles.alertBox}>
                <Text style={styles.alertTitle}>
                  ⚠ {droneZones.length} Drone-Required Zone
                  {droneZones.length > 1 ? 's' : ''} Detected
                </Text>
                {droneZones.map(n => (
                  <Text key={n.nodeId} style={styles.alertItem}>
                    • {n.displayName} ({n.isolated ? 'ISOLATED' : 'DRONE ONLY'})
                  </Text>
                ))}
              </View>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  floodActive ? styles.btnReset : styles.btnDanger,
                  loading && styles.disabled,
                ]}
                disabled={loading}
                onPress={handleFloodToggle}
              >
                <Text style={styles.actionBtnText}>
                  {floodActive ? '↺ Reset Flood' : '🌊 Simulate Flood'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.btnSecondary,
                  loading && styles.disabled,
                ]}
                disabled={loading}
                onPress={refresh}
              >
                <Text style={styles.actionBtnText}>↻ Refresh</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>
              All Nodes ({reachability.length})
            </Text>
            {reachability.map(node => (
              <View key={node.nodeId} style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardIcon}>
                    {NODE_TYPE_ICON[node.nodeType] ?? '📍'}
                  </Text>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{node.displayName}</Text>
                    <Text style={styles.cardMeta}>
                      {node.nodeId} · {node.nodeType}
                    </Text>
                    <View style={styles.chipRow}>
                      {node.reachableByTruck && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>🚛</Text>
                        </View>
                      )}
                      {node.reachableByBoat && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>⛵</Text>
                        </View>
                      )}
                      {node.reachableByDrone && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>🚁</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <ReachabilityBadge node={node} />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── M8.2: Rendezvous ─────────────────────────────────────────── */}
        {activeSection === 'rendezvous' && (
          <View>
            <Text style={styles.sectionTitle}>
              Optimal Rendezvous Computation
            </Text>
            <Text style={styles.sectionSubtitle}>
              Minimises max(vehicle_time, drone_time) for simultaneous arrival
            </Text>

            {DEMO_RENDEZVOUS_SCENARIOS.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.card,
                  styles.scenarioCard,
                  loading && styles.disabled,
                ]}
                disabled={loading}
                onPress={() => handleRendezvous(i)}
              >
                <Text style={styles.scenarioLabel}>{s.scenarioLabel}</Text>
                <Text style={styles.cardMeta}>
                  Vehicle: {s.vehicleType} from {s.vehicleNodeId} · Drone max:{' '}
                  {s.droneMaxMinutes} min · Payload: {s.payloadWeightKg} kg
                </Text>
              </TouchableOpacity>
            ))}

            {rendezvousResult && (
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>
                  {rendezvousResult.scenarioLabel}
                </Text>
                {rendezvousResult.constraintViolation ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>
                      ✗ {rendezvousResult.constraintViolation}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.bestBox}>
                      <Text style={styles.bestLabel}>Optimal Rendezvous</Text>
                      <Text style={styles.bestNode}>
                        📍 {rendezvousResult.best?.displayName} (
                        {rendezvousResult.best?.nodeId})
                      </Text>
                      <Text style={styles.bestCoord}>
                        {rendezvousResult.best?.lat.toFixed(4)},{' '}
                        {rendezvousResult.best?.lng.toFixed(4)}
                      </Text>
                      <View style={styles.etaRow}>
                        <View style={styles.etaBox}>
                          <Text style={styles.etaLabel}>Vehicle ETA</Text>
                          <Text style={styles.etaValue}>
                            {rendezvousResult.best?.vehicleTimeMinutes} min
                          </Text>
                        </View>
                        <View style={styles.etaBox}>
                          <Text style={styles.etaLabel}>Drone ETA</Text>
                          <Text style={styles.etaValue}>
                            {rendezvousResult.best?.droneTimeMinutes} min
                          </Text>
                        </View>
                        <View style={[styles.etaBox, styles.etaBoxHighlight]}>
                          <Text style={styles.etaLabel}>Meet Time</Text>
                          <Text style={styles.etaValue}>
                            {rendezvousResult.best?.meetTimeMinutes} min
                          </Text>
                        </View>
                      </View>
                    </View>
                    {rendezvousResult.allCandidates.length > 1 && (
                      <>
                        <Text style={styles.candidatesHeader}>
                          All candidates (
                          {rendezvousResult.allCandidates.length}):
                        </Text>
                        {rendezvousResult.allCandidates
                          .slice(0, 4)
                          .map((c, ci) => (
                            <Text key={ci} style={styles.candidateRow}>
                              {ci === 0 ? '★' : ' '} {c.displayName} — v:
                              {c.vehicleTimeMinutes}m d:{c.droneTimeMinutes}m →
                              meet:{c.meetTimeMinutes}m
                            </Text>
                          ))}
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── M8.3: Handoff ─────────────────────────────────────────────── */}
        {activeSection === 'handoff' && (
          <View>
            <Text style={styles.sectionTitle}>Handoff Coordination</Text>
            <Text style={styles.sectionSubtitle}>
              Initiate → vehicle arrives at rendezvous → PoD signed with M5 →
              drone counter-signs
            </Text>

            {DEMO_RENDEZVOUS_SCENARIOS.slice(0, 2).map((s, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.card,
                  styles.scenarioCard,
                  loading && styles.disabled,
                ]}
                disabled={loading}
                onPress={() => handleInitiateHandoff(i)}
              >
                <Text style={styles.scenarioLabel}>
                  ↗ Initiate: {s.scenarioLabel}
                </Text>
                <Text style={styles.cardMeta}>
                  {s.payloadWeightKg}kg · {s.vehicleType}
                </Text>
              </TouchableOpacity>
            ))}

            {handoffs.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>
                  Active Handoffs ({handoffs.length})
                </Text>
                {handoffs.map(h => (
                  <View
                    key={h.handoffId}
                    style={[styles.card, styles.handoffCard]}
                  >
                    <View style={styles.cardRow}>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardTitle}>{h.handoffId}</Text>
                        <Text style={styles.cardMeta}>
                          {h.scenarioLabel ?? 'Manual handoff'}
                        </Text>
                        <Text style={styles.cardMeta}>
                          {h.vehicleType} → rendezvous{' '}
                          {h.rendezvousNodeId ?? '?'} → dest {h.destNodeId}
                        </Text>
                        {h.vehicleEtaMinutes !== null && (
                          <Text style={styles.cardMeta}>
                            Vehicle: {h.vehicleEtaMinutes}m · Drone:{' '}
                            {h.droneEtaMinutes}m
                          </Text>
                        )}
                        {h.podReceiptId && (
                          <Text style={styles.receiptHint}>
                            Receipt: {h.podReceiptId}
                          </Text>
                        )}
                      </View>
                      <View style={styles.rightCol}>
                        <View
                          style={[
                            styles.badge,
                            {
                              backgroundColor:
                                h.status === 'completed'
                                  ? '#38a169'
                                  : h.status === 'computed'
                                  ? '#3182ce'
                                  : '#d69e2e',
                            },
                          ]}
                        >
                          <Text style={styles.badgeText}>
                            {h.status.toUpperCase()}
                          </Text>
                        </View>
                        {h.status !== 'completed' && (
                          <TouchableOpacity
                            style={[styles.miniBtn, loading && styles.disabled]}
                            disabled={loading}
                            onPress={() => handleCompleteHandoff(h.handoffId)}
                          >
                            <Text style={styles.miniBtnText}>Complete</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* ── M8.4: Battery throttling ─────────────────────────────────── */}
        {activeSection === 'battery' && (
          <View>
            <Text style={styles.sectionTitle}>
              Battery-Aware Mesh Throttling
            </Text>
            <Text style={styles.sectionSubtitle}>
              Broadcast interval scales with battery, motion, and nearby nodes
            </Text>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.btnPrimary,
                loading && styles.disabled,
              ]}
              disabled={loading}
              onPress={handleBatterySim}
            >
              <Text style={styles.actionBtnText}>▶ Run 10-min Simulation</Text>
            </TouchableOpacity>

            <View style={styles.throttleRules}>
              <Text style={styles.throttleRuleTitle}>Throttle Rules</Text>
              <Text style={styles.throttleRule}>
                • Battery &lt;30% → ×2.5 interval (−60% broadcasts)
              </Text>
              <Text style={styles.throttleRule}>
                • Stationary → ×5 interval (−80% broadcasts)
              </Text>
              <Text style={styles.throttleRule}>
                • ≥3 nearby nodes → ×1.5 interval
              </Text>
              <Text style={styles.throttleRule}>
                • Compound: stationary + low bat → ×12.5 (−92%)
              </Text>
            </View>

            {throttleResult && (
              <View style={styles.simResult}>
                {/* Summary strip */}
                <View style={styles.simSummary}>
                  <View style={styles.simStat}>
                    <Text style={styles.simStatNum}>
                      {throttleResult.baselineBroadcasts}
                    </Text>
                    <Text style={styles.simStatLabel}>Baseline</Text>
                  </View>
                  <View style={styles.simStat}>
                    <Text style={styles.simStatNum}>
                      {throttleResult.actualBroadcasts}
                    </Text>
                    <Text style={styles.simStatLabel}>Actual</Text>
                  </View>
                  <View style={[styles.simStat, styles.simStatHighlight]}>
                    <Text style={[styles.simStatNum, { color: '#68d391' }]}>
                      −{throttleResult.savedPct}%
                    </Text>
                    <Text style={styles.simStatLabel}>Saved</Text>
                  </View>
                </View>

                {/* Per-minute table */}
                <View style={styles.tableHeader}>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellHdr,
                      { flex: 0.6 },
                    ]}
                  >
                    min
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellHdr,
                      { flex: 0.8 },
                    ]}
                  >
                    bat%
                  </Text>
                  <Text
                    style={[styles.tableCell, styles.tableCellHdr, { flex: 1 }]}
                  >
                    mvmt
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellHdr,
                      { flex: 1.2 },
                    ]}
                  >
                    interval
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellHdr,
                      { flex: 0.8 },
                    ]}
                  >
                    save
                  </Text>
                </View>
                {throttleResult.entries.map((e, i) => (
                  <View
                    key={i}
                    style={[
                      styles.tableRow,
                      e.reductionPct > 50 && styles.tableRowHighlight,
                    ]}
                  >
                    <Text style={[styles.tableCell, { flex: 0.6 }]}>
                      {e.timeMinutes}
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        {
                          flex: 0.8,
                          color: e.batteryPct < 30 ? '#e53e3e' : '#e2e8f0',
                        },
                      ]}
                    >
                      {e.batteryPct}%
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        {
                          flex: 1,
                          color: e.isStationary ? '#d69e2e' : '#68d391',
                        },
                      ]}
                    >
                      {e.isStationary ? '■ still' : '▶ move'}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1.2 }]}>
                      {(e.broadcastIntervalMs / 1000).toFixed(1)}s
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        {
                          flex: 0.8,
                          color: e.reductionPct > 0 ? '#68d391' : '#718096',
                        },
                      ]}
                    >
                      {e.reductionPct > 0 ? `−${e.reductionPct}%` : '—'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e1a' },
  scroll: { flex: 1 },
  // Section nav
  sectionNav: {
    flexDirection: 'row',
    backgroundColor: '#151b2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2d3748',
  },
  sectionBtn: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  sectionBtnActive: { borderBottomWidth: 2, borderBottomColor: '#90cdf4' },
  sectionBtnText: { color: '#718096', fontSize: 10, fontWeight: '600' },
  sectionBtnTextActive: { color: '#90cdf4' },
  // Titles
  sectionTitle: {
    color: '#90cdf4',
    fontWeight: '700',
    fontSize: 13,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
  },
  sectionSubtitle: {
    color: '#4a5568',
    fontSize: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  // Alert box
  alertBox: {
    margin: 12,
    padding: 10,
    backgroundColor: '#3d2a00',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d69e2e',
  },
  alertTitle: {
    color: '#d69e2e',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  alertItem: { color: '#f6c760', fontSize: 11 },
  // Action buttons
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  actionBtn: { borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
  btnDanger: { backgroundColor: '#9b2c2c' },
  btnReset: { backgroundColor: '#276749' },
  btnSecondary: { backgroundColor: '#2d3748' },
  btnPrimary: {
    backgroundColor: '#2b6cb0',
    marginHorizontal: 12,
    marginBottom: 8,
  },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  // Cards
  card: {
    backgroundColor: '#1a2035',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2d3748',
  },
  handoffCard: { borderColor: '#4a5568' },
  scenarioCard: { borderColor: '#4a5568', borderStyle: 'dashed' },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  cardIcon: { fontSize: 20, marginRight: 10, marginTop: 2 },
  cardInfo: { flex: 1 },
  cardTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardMeta: { color: '#718096', fontSize: 10, marginBottom: 1 },
  chipRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  chip: {
    backgroundColor: '#2d3748',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11 },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '700' },
  scenarioLabel: {
    color: '#90cdf4',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  miniBtn: {
    backgroundColor: '#2b6cb0',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  miniBtnText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  receiptHint: { color: '#68d391', fontSize: 9, marginTop: 2 },
  // Rendezvous result
  resultCard: {
    backgroundColor: '#151b2e',
    margin: 12,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#4a5568',
  },
  resultTitle: {
    color: '#90cdf4',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 8,
  },
  errorBox: { backgroundColor: '#6b1e1e', borderRadius: 6, padding: 8 },
  errorText: { color: '#feb2b2', fontSize: 11 },
  bestBox: {
    backgroundColor: '#1a2035',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  bestLabel: {
    color: '#68d391',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  bestNode: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  bestCoord: {
    color: '#718096',
    fontSize: 9,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  etaRow: { flexDirection: 'row', gap: 8 },
  etaBox: {
    flex: 1,
    backgroundColor: '#2d3748',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
  },
  etaBoxHighlight: { backgroundColor: '#2a4365' },
  etaLabel: { color: '#718096', fontSize: 9, marginBottom: 2 },
  etaValue: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  candidatesHeader: { color: '#718096', fontSize: 10, marginBottom: 4 },
  candidateRow: {
    color: '#a0aec0',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  // Battery sim
  throttleRules: {
    backgroundColor: '#151b2e',
    margin: 12,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2d3748',
  },
  throttleRuleTitle: {
    color: '#90cdf4',
    fontWeight: '700',
    fontSize: 11,
    marginBottom: 6,
  },
  throttleRule: { color: '#a0aec0', fontSize: 10, marginBottom: 2 },
  simResult: { marginHorizontal: 12, marginTop: 8 },
  simSummary: {
    flexDirection: 'row',
    backgroundColor: '#1a2035',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  simStat: { flex: 1, alignItems: 'center' },
  simStatHighlight: { backgroundColor: '#1a3a2a', borderRadius: 6, padding: 4 },
  simStatNum: { color: '#e2e8f0', fontSize: 18, fontWeight: '700' },
  simStatLabel: { color: '#718096', fontSize: 9 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#2d3748',
    paddingBottom: 4,
    marginBottom: 2,
  },
  tableCellHdr: { color: '#718096', fontWeight: '700' },
  tableRow: { flexDirection: 'row', paddingVertical: 3 },
  tableRowHighlight: { backgroundColor: '#1a2a1a' },
  tableCell: { color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' },
  bottomPad: { height: 24 },
});
