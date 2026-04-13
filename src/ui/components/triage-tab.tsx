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
  type CargoDraft,
  type CargoRecord,
  type TriageDecisionRecord,
  addCargo,
  getAllCargo,
  getTriageDecisions,
  injectRouteSlowdown,
  resetTriage,
  runAutonomousTriage,
} from '../../api/triage';
import { PRIORITY_META, type CargoPriority } from '../../core/triage/engine';

type Props = { user: RegisteredUser };

const STATUS_COLOR: Record<string, string> = {
  active: '#38a169',
  at_risk: '#d69e2e',
  breached: '#e53e3e',
  dropped: '#805ad5',
  delivered: '#3182ce',
};

const DECISION_COLOR: Record<string, string> = {
  keep: '#38a169',
  drop_to_waypoint: '#805ad5',
  reroute_priority: '#e53e3e',
};

export function TriageTab({ user }: Props) {
  const [cargo, setCargo] = useState<CargoRecord[]>([]);
  const [decisions, setDecisions] = useState<TriageDecisionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Add-cargo form state
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<CargoPriority>('P1');
  const [newEtaHours, setNewEtaHours] = useState('4');

  const load = useCallback(async () => {
    const [c, d] = await Promise.all([getAllCargo(), getTriageDecisions()]);
    setCargo(c);
    setDecisions(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddCargo = useCallback(async () => {
    if (!newLabel.trim()) {
      Alert.alert('Missing Label', 'Enter a cargo label.');
      return;
    }
    const etaH = parseFloat(newEtaHours);
    if (isNaN(etaH) || etaH <= 0) {
      Alert.alert('Invalid ETA', 'Enter a positive number of hours.');
      return;
    }
    const draft: CargoDraft = {
      label: newLabel.trim(),
      description: newDesc.trim() || undefined,
      priority: newPriority,
      etaOffsetMs: etaH * 60 * 60 * 1000,
    };
    await addCargo(user, draft);
    setNewLabel('');
    setNewDesc('');
    setNewPriority('P1');
    setNewEtaHours('4');
    setShowAdd(false);
    await load();
  }, [user, newLabel, newDesc, newPriority, newEtaHours, load]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setLoading(true);
      try {
        await action();
        await load();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  const handleSlowdown = useCallback(
    (pct: number) =>
      run(async () => {
        await injectRouteSlowdown(user, pct);
      }),
    [user, run],
  );

  const handleTriage = useCallback(
    () =>
      run(async () => {
        const decs = await runAutonomousTriage(user);
        const dropped = decs.filter(d => d.decisionType === 'drop_to_waypoint');
        const rerouted = decs.filter(
          d => d.decisionType === 'reroute_priority',
        );
        Alert.alert(
          'Autonomous Triage Complete',
          `${rerouted.length} high-priority cargo rerouted\n` +
            `${dropped.length} low-priority cargo deposited at waypoint\n\n` +
            'Decision rationale logged to Audit Trail.',
        );
      }),
    [user, run],
  );

  const handleReset = useCallback(
    () =>
      run(async () => {
        await resetTriage(user);
      }),
    [user, run],
  );

  // Summary counts
  const active = cargo.filter(c => c.status === 'active').length;
  const atRisk = cargo.filter(c => c.status === 'at_risk').length;
  const breached = cargo.filter(c => c.status === 'breached').length;
  const dropped = cargo.filter(c => c.status === 'dropped').length;

  return (
    <View>
      {/* Header */}
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>SLA PREEMPTION · AUTONOMOUS ROUTING</Text>
        <Text style={styles.title}>Triage Engine</Text>
        <Text style={styles.subtitle}>
          Monitors cargo SLA windows in real time. When a route slowdown
          threatens delivery, the engine autonomously drops low-priority cargo
          at safe waypoints and reroutes critical supplies.
        </Text>
      </View>

      {/* Priority legend */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Priority Tiers (M6.1)</Text>
        <View style={styles.legendGrid}>
          {(['P0', 'P1', 'P2', 'P3'] as const).map(p => (
            <View
              key={p}
              style={[
                styles.legendCard,
                { borderLeftColor: PRIORITY_META[p].color },
              ]}
            >
              <Text
                style={[
                  styles.legendPriority,
                  { color: PRIORITY_META[p].color },
                ]}
              >
                {p}
              </Text>
              <Text style={styles.legendSla}>
                SLA: {PRIORITY_META[p].slaWindowMs / 3600000}h
              </Text>
              <Text style={styles.legendDesc} numberOfLines={2}>
                {PRIORITY_META[p].description}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Add Cargo */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => setShowAdd(!showAdd)}
          activeOpacity={0.8}
        >
          <Text style={styles.btnSecondaryText}>
            {showAdd ? '✕ Cancel' : '＋ Add Cargo Item'}
          </Text>
        </TouchableOpacity>
        {showAdd && (
          <View style={{ marginTop: 10, gap: 8 }}>
            <TextInput
              style={styles.formInput}
              placeholder="Label (e.g. Antivenom Supply)"
              placeholderTextColor="#9da3b0"
              value={newLabel}
              onChangeText={setNewLabel}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Description (optional)"
              placeholderTextColor="#9da3b0"
              value={newDesc}
              onChangeText={setNewDesc}
            />
            <Text style={styles.formLabel}>Priority</Text>
            <View style={styles.chipRow}>
              {(['P0', 'P1', 'P2', 'P3'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.chip,
                    newPriority === p && {
                      backgroundColor: PRIORITY_META[p].color + '22',
                      borderColor: PRIORITY_META[p].color,
                    },
                  ]}
                  onPress={() => setNewPriority(p)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      newPriority === p && { color: PRIORITY_META[p].color },
                    ]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.formInput}
              placeholder="ETA (hours from now)"
              placeholderTextColor="#9da3b0"
              keyboardType="numeric"
              value={newEtaHours}
              onChangeText={setNewEtaHours}
            />
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={handleAddCargo}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>Add Cargo</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatBox label="On Track" value={active} color="#38a169" />
        <StatBox label="At Risk" value={atRisk} color="#d69e2e" />
        <StatBox label="Breached" value={breached} color="#e53e3e" />
        <StatBox label="Dropped" value={dropped} color="#805ad5" />
      </View>

      {/* Slowdown injection (M6.2) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inject Route Slowdown (M6.2)</Text>
        <Text style={styles.sectionSub}>
          ≥30% slowdown triggers SLA breach prediction across all active cargo.
        </Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSlowdown(0)}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.chipText}>0% (Normal)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, styles.chipWarn]}
            onPress={() => handleSlowdown(30)}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, styles.chipTextWarn]}>
              +30% Slow
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, styles.chipDanger]}
            onPress={() => handleSlowdown(60)}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, styles.chipTextDanger]}>
              +60% Slow
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, styles.chipDanger]}
            onPress={() => handleSlowdown(110)}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, styles.chipTextDanger]}>
              +110% Blocked
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Autonomous triage action (M6.3) */}
      <TouchableOpacity
        style={[styles.btnPrimary, loading && styles.btnDisabled]}
        onPress={handleTriage}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.btnPrimaryText}>
          {loading ? 'Processing…' : '⚡ Run Autonomous Triage (M6.3)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.btnSecondary,
          { marginTop: 8 },
          loading && styles.btnDisabled,
        ]}
        onPress={handleReset}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Text style={styles.btnSecondaryText}>
          ↺ Reset to Normal Conditions
        </Text>
      </TouchableOpacity>

      {/* Cargo list */}
      {cargo.length > 0 && (
        <View style={[styles.section, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Active Cargo</Text>
          {cargo.map(c => (
            <CargoCard key={c.cargoId} cargo={c} />
          ))}
        </View>
      )}

      {/* Decisions log */}
      {decisions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Autonomous Decisions Log</Text>
          <Text style={styles.sectionSub}>
            Persisted to immutable audit trail.
          </Text>
          {decisions.slice(0, 10).map(d => (
            <DecisionCard key={d.decisionId} decision={d} />
          ))}
        </View>
      )}

      {/* How it works */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Demo walkthrough</Text>
        <Text style={styles.infoText}>
          {'1. Observe 4 cargo items at P0–P3 with different SLA windows\n\n' +
            '2. Tap "+30% Slow" — P2/P3 cargo moves to At Risk\n\n' +
            '3. Tap "+60% Slow" — P2/P3 breach; P0/P1 go At Risk\n\n' +
            '4. Tap "Run Autonomous Triage" — engine decides:\n' +
            '   • P0/P1 → Reroute with priority\n' +
            '   • P2/P3 → Drop at safe waypoint\n\n' +
            '5. Check the Audit tab — each decision is hash-chained\n' +
            '   into the immutable log for non-repudiation.'}
        </Text>
      </View>
    </View>
  );
}

function CargoCard({ cargo: c }: { cargo: CargoRecord }) {
  const meta = PRIORITY_META[c.priority];
  const statusColor = STATUS_COLOR[c.status] ?? '#131b2e';
  const deadlineMs = c.createdAtMs + c.slaWindowMs;
  const msLeft = Math.max(0, deadlineMs - Date.now());
  const hoursLeft = (msLeft / 3600000).toFixed(1);
  const slowdownLabel =
    c.routeSlowdownPct > 0 ? ` (+${c.routeSlowdownPct}% slowdown)` : '';

  return (
    <View style={[styles.cargoCard, { borderLeftColor: meta.color }]}>
      <View style={styles.cargoTop}>
        <View
          style={[styles.priorityBadge, { backgroundColor: meta.color + '22' }]}
        >
          <Text style={[styles.priorityText, { color: meta.color }]}>
            {c.priority}
          </Text>
        </View>
        <View
          style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>
            {c.status.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.cargoLabel}>{c.label}</Text>
      <Text style={styles.cargoDep} numberOfLines={1}>
        {c.description}
      </Text>
      <View style={styles.cargoFooter}>
        <Text style={styles.cargoMeta}>
          SLA: {c.slaWindowMs / 3600000}h window · {hoursLeft}h remaining
          {slowdownLabel}
        </Text>
        {c.waypointLabel && (
          <Text style={styles.waypointText}>📍 {c.waypointLabel}</Text>
        )}
      </View>
    </View>
  );
}

function DecisionCard({ decision: d }: { decision: TriageDecisionRecord }) {
  const color = DECISION_COLOR[d.decisionType] ?? '#131b2e';
  const icon =
    d.decisionType === 'drop_to_waypoint'
      ? '📦'
      : d.decisionType === 'reroute_priority'
      ? '🚨'
      : '✓';

  return (
    <View style={styles.decisionCard}>
      <View style={styles.decisionHeader}>
        <View style={[styles.decisionBadge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.decisionType, { color }]}>
            {icon} {d.decisionType.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
        <View
          style={[
            styles.priorityBadge,
            { backgroundColor: PRIORITY_META[d.priority].color + '22' },
          ]}
        >
          <Text
            style={[
              styles.priorityText,
              { color: PRIORITY_META[d.priority].color },
            ]}
          >
            {d.priority}
          </Text>
        </View>
      </View>
      <Text style={styles.rationaleText}>{d.rationale}</Text>
      {d.waypoint && (
        <Text style={styles.waypointText}>📍 Waypoint: {d.waypoint}</Text>
      )}
    </View>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statNum, { color }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 20 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#e53e3e',
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#131b2e', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#565e74', lineHeight: 19 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  sectionSub: { fontSize: 12, color: '#9da3b0', marginBottom: 10 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#f8f9ff',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 4,
    gap: 3,
  },
  legendPriority: { fontSize: 15, fontWeight: '800' },
  legendSla: { fontSize: 11, color: '#565e74', fontWeight: '600' },
  legendDesc: { fontSize: 10, color: '#9da3b0', lineHeight: 14 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statBox: {
    flex: 1,
    backgroundColor: '#f2f3ff',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLbl: { fontSize: 9, color: '#565e74', marginTop: 2 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f2f3ff',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  chipWarn: { backgroundColor: '#fffaf0', borderColor: '#d69e2e' },
  chipDanger: { backgroundColor: '#fff5f5', borderColor: '#e53e3e' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#565e74' },
  chipTextWarn: { color: '#d69e2e' },
  chipTextDanger: { color: '#e53e3e' },
  btnPrimary: {
    backgroundColor: '#e53e3e',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  btnSecondaryText: { color: '#131b2e', fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  cargoCard: {
    backgroundColor: '#f8f9ff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#e4e6f0',
    gap: 6,
  },
  cargoTop: { flexDirection: 'row', gap: 8 },
  cargoLabel: { fontSize: 14, fontWeight: '700', color: '#131b2e' },
  cargoDep: { fontSize: 12, color: '#565e74' },
  cargoFooter: { gap: 3 },
  cargoMeta: { fontSize: 11, color: '#9da3b0' },
  priorityBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityText: { fontSize: 11, fontWeight: '800' },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  waypointText: { fontSize: 11, color: '#805ad5', fontWeight: '600' },
  decisionCard: {
    backgroundColor: '#f8f9ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e4e6f0',
    gap: 6,
  },
  decisionHeader: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  decisionBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  decisionType: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  rationaleText: { fontSize: 12, color: '#565e74', lineHeight: 17 },
  infoBox: {
    backgroundColor: '#fff5f5',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#e53e3e',
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  infoText: { fontSize: 12, color: '#565e74', lineHeight: 18 },
  formInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c2c6d6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#131b2e',
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#565e74',
    marginBottom: -2,
  },
});
