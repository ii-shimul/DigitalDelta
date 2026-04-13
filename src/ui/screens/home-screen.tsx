import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RegisteredUser } from '../../api/auth';
import {
  getAuditLogCount,
  getDeviceIdentity,
  injectAuditCorruption,
  verifyAuditTrail,
} from '../../api/auth';
import { getConflicts } from '../../api/inventory';
import { InventoryTab } from '../components/inventory-tab';
import { FleetTab } from '../components/fleet-tab';
import { MeshTab } from '../components/mesh-tab';
import { PodTab } from '../components/pod-tab';
import { RoutingTab } from '../components/routing-tab';
import { TriageTab } from '../components/triage-tab';
import type {
  AppRole,
  AuditChainVerificationResult,
  DeviceIdentityRecord,
} from '../../core/contracts';

const ROLE_LABELS: Record<string, string> = {
  FIELD_VOLUNTEER: 'Field Volunteer',
  SUPPLY_MANAGER: 'Supply Manager',
  DRONE_OPERATOR: 'Drone Operator',
  CAMP_COMMANDER: 'Camp Commander',
  SYNC_ADMIN: 'Sync Admin',
};

type Props = {
  user: RegisteredUser;
  onLogout: () => void;
};

type Tab =
  | 'mission'
  | 'identity'
  | 'audit'
  | 'inventory'
  | 'mesh'
  | 'triage'
  | 'routing'
  | 'pod'
  | 'fleet';

/** RBAC — tabs each role can access (mission + identity are universal) */
const ROLE_TAB_ACCESS: Record<AppRole, readonly Tab[]> = {
  FIELD_VOLUNTEER: [
    'mission',
    'identity',
    'audit',
    'inventory',
    'mesh',
    'routing',
    'pod',
  ],
  SUPPLY_MANAGER: [
    'mission',
    'identity',
    'audit',
    'inventory',
    'mesh',
    'triage',
    'routing',
    'pod',
  ],
  DRONE_OPERATOR: [
    'mission',
    'identity',
    'audit',
    'mesh',
    'routing',
    'pod',
    'fleet',
  ],
  CAMP_COMMANDER: [
    'mission',
    'identity',
    'audit',
    'inventory',
    'routing',
    'pod',
    'triage',
  ],
  SYNC_ADMIN: [
    'mission',
    'identity',
    'audit',
    'inventory',
    'mesh',
    'triage',
    'routing',
    'pod',
    'fleet',
  ],
};

/** A5 — System state shown across all tabs */
type SystemState = 'offline' | 'syncing' | 'conflict' | 'verified';

const STATE_META: Record<
  SystemState,
  { label: string; color: string; bg: string; dot: string }
> = {
  offline: {
    label: 'Offline',
    color: '#565e74',
    bg: '#f2f3ff',
    dot: '#9da3b0',
  },
  syncing: {
    label: 'Syncing…',
    color: '#0058be',
    bg: '#e0ecff',
    dot: '#3182ce',
  },
  conflict: {
    label: 'Conflict Detected',
    color: '#93000a',
    bg: '#ffdad6',
    dot: '#e53e3e',
  },
  verified: {
    label: 'Verified',
    color: '#006947',
    bg: '#d4edda',
    dot: '#38a169',
  },
};

export default function HomeScreen({ user, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('mission');
  const [deviceIdentity, setDeviceIdentity] =
    useState<DeviceIdentityRecord | null>(null);
  const [auditResult, setAuditResult] =
    useState<AuditChainVerificationResult | null>(null);
  const [auditCount, setAuditCount] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  const allowedTabs =
    ROLE_TAB_ACCESS[user.role] ?? ROLE_TAB_ACCESS.FIELD_VOLUNTEER;
  const canAccess = (tab: Tab) => allowedTabs.includes(tab);

  // A5 — dynamic system state for the persistent banner
  const [systemState, setSystemState] = useState<SystemState>('offline');
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    if (user.deviceId) {
      getDeviceIdentity(user.deviceId).then(setDeviceIdentity);
    }
    getAuditLogCount().then(setAuditCount);
  }, [user.deviceId]);

  // Poll for conflicts and audit to update the state banner
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const conflicts = await getConflicts();
        if (!active) return;
        const count = conflicts.filter(c => !c.resolvedAtMs).length;
        setConflictCount(count);
        if (count > 0) {
          setSystemState('conflict');
        } else if (auditResult?.valid) {
          setSystemState('verified');
        } else {
          setSystemState('offline');
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [auditResult]);

  const handleVerifyAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const result = await verifyAuditTrail();
      setAuditResult(result);
      setAuditCount(result.scannedEntries);
    } catch (e) {
      Alert.alert(
        'Error',
        e instanceof Error ? e.message : 'Audit check failed',
      );
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleInjectCorruption = useCallback(async () => {
    Alert.alert(
      'Inject Audit Corruption',
      'This will tamper with the latest audit log entry to demonstrate tamper detection. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Inject',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await injectAuditCorruption();
              if (result.corrupted) {
                Alert.alert(
                  'Corruption Injected',
                  `Log entry ${result.logId} has been tampered with. Run "Verify Audit Trail" to detect it.`,
                );
                setAuditResult(null);
              }
            } catch (e) {
              Alert.alert(
                'Error',
                e instanceof Error ? e.message : 'Failed to inject',
              );
            }
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar} accessibilityRole="header">
        <View style={styles.topBarLeft}>
          <Text style={styles.brandText} accessibilityRole="header">
            Digital Delta
          </Text>
        </View>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={onLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* A5 — Persistent system state banner */}
      <View
        style={[
          styles.stateBanner,
          { backgroundColor: STATE_META[systemState].bg },
        ]}
        accessibilityRole="alert"
        accessibilityLabel={`System state: ${STATE_META[systemState].label}${
          conflictCount > 0 ? `, ${conflictCount} conflicts` : ''
        }`}
      >
        <View
          style={[
            styles.stateDot,
            { backgroundColor: STATE_META[systemState].dot },
          ]}
        />
        <Text
          style={[styles.stateLabel, { color: STATE_META[systemState].color }]}
        >
          {STATE_META[systemState].label}
        </Text>
        {conflictCount > 0 && (
          <View style={styles.conflictBadge}>
            <Text style={styles.conflictBadgeText}>{conflictCount}</Text>
          </View>
        )}
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {activeTab === 'mission' && renderMission()}
        {activeTab === 'identity' && renderIdentity()}
        {activeTab === 'audit' && renderAudit()}
        {activeTab === 'inventory' && canAccess('inventory') && (
          <InventoryTab user={user} />
        )}
        {activeTab === 'mesh' && canAccess('mesh') && <MeshTab user={user} />}
        {activeTab === 'triage' && canAccess('triage') && (
          <TriageTab user={user} />
        )}
        {activeTab === 'routing' && canAccess('routing') && <RoutingTab />}
        {activeTab === 'pod' && canAccess('pod') && <PodTab user={user} />}
        {activeTab === 'fleet' && canAccess('fleet') && (
          <FleetTab user={user} />
        )}
      </ScrollView>

      {/* Bottom Nav — filtered by RBAC */}
      <View style={styles.bottomNav}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bottomNavContent}
          accessibilityRole="tablist"
        >
          {canAccess('mission') && (
            <TabButton
              label="Mission"
              active={activeTab === 'mission'}
              onPress={() => setActiveTab('mission')}
            />
          )}
          {canAccess('identity') && (
            <TabButton
              label="Identity"
              active={activeTab === 'identity'}
              onPress={() => setActiveTab('identity')}
            />
          )}
          {canAccess('inventory') && (
            <TabButton
              label="Inventory"
              active={activeTab === 'inventory'}
              onPress={() => setActiveTab('inventory')}
            />
          )}
          {canAccess('audit') && (
            <TabButton
              label="Audit"
              active={activeTab === 'audit'}
              onPress={() => setActiveTab('audit')}
            />
          )}
          {canAccess('mesh') && (
            <TabButton
              label="Mesh"
              active={activeTab === 'mesh'}
              onPress={() => setActiveTab('mesh')}
            />
          )}
          {canAccess('triage') && (
            <TabButton
              label="Triage"
              active={activeTab === 'triage'}
              onPress={() => setActiveTab('triage')}
            />
          )}
          {canAccess('routing') && (
            <TabButton
              label="Routes"
              active={activeTab === 'routing'}
              onPress={() => setActiveTab('routing')}
            />
          )}
          {canAccess('pod') && (
            <TabButton
              label="PoD"
              active={activeTab === 'pod'}
              onPress={() => setActiveTab('pod')}
            />
          )}
          {canAccess('fleet') && (
            <TabButton
              label="Fleet"
              active={activeTab === 'fleet'}
              onPress={() => setActiveTab('fleet')}
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );

  function renderMission() {
    return (
      <>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>
            {ROLE_LABELS[user.role] ?? user.role}
          </Text>
          <Text style={styles.heroTitle}>Mission Control</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>System Active</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.statusPeers}>Offline Mode</Text>
          </View>
        </View>

        {/* Alert Card */}
        <View style={styles.alertCard}>
          <View style={styles.alertBadge}>
            <Text style={styles.alertBadgeText}>SCENARIO ACTIVE</Text>
          </View>
          <Text style={styles.alertTitle}>Sylhet Flash Flood Response</Text>
          <Text style={styles.alertDesc}>
            Flood waters rising in northern districts. Relief coordination
            active across decentralized mesh network. All communications
            encrypted end-to-end.
          </Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{auditCount}</Text>
            <Text style={styles.statLabel}>Auth Events</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>Ed25519</Text>
            <Text style={styles.statLabel}>Key Algorithm</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>TOTP</Text>
            <Text style={styles.statLabel}>OTP Method</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>SHA-256</Text>
            <Text style={styles.statLabel}>Hash Chain</Text>
          </View>
        </View>

        {/* Info Card */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>System Capabilities</Text>
          <View style={styles.capabilityList}>
            <CapabilityRow label="Offline Authentication" status="active" />
            <CapabilityRow label="Cryptographic Identity" status="active" />
            <CapabilityRow label="Tamper-Evident Audit Log" status="active" />
            <CapabilityRow label="Role-Based Access Control" status="active" />
            <CapabilityRow label="CRDT Inventory Sync" status="active" />
            <CapabilityRow label="Vector Clock Causality" status="active" />
            <CapabilityRow label="Conflict Resolution" status="active" />
            <CapabilityRow label="Mesh Network Sync" status="pending" />
            <CapabilityRow label="Route Optimization" status="pending" />
          </View>
        </View>
      </>
    );
  }

  function renderIdentity() {
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>CRYPTOGRAPHIC IDENTITY</Text>
          <Text style={styles.heroTitle}>Device Profile</Text>
        </View>

        {/* User Info */}
        <View style={styles.detailCard}>
          <DetailRow label="Name" value={user.displayName} />
          <DetailRow label="User ID" value={user.userId} mono />
          <DetailRow label="Device ID" value={user.deviceId} mono />
          <DetailRow label="Role" value={ROLE_LABELS[user.role] ?? user.role} />
        </View>

        {/* Key Info */}
        {deviceIdentity ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailCardTitle}>Ed25519 Key Pair</Text>
            <DetailRow
              label="Algorithm"
              value={deviceIdentity.keyAlgorithm}
              mono
            />
            <DetailRow
              label="Fingerprint"
              value={deviceIdentity.keyFingerprint}
              mono
            />
            <DetailRow
              label="Provisioned"
              value={new Date(deviceIdentity.provisionedAtMs).toLocaleString()}
            />
            {deviceIdentity.lastRotatedAtMs ? (
              <DetailRow
                label="Last Rotated"
                value={new Date(
                  deviceIdentity.lastRotatedAtMs,
                ).toLocaleString()}
              />
            ) : null}
          </View>
        ) : null}

        {/* Public Key Preview */}
        {deviceIdentity?.publicKeyPem ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeTitle}>Public Key (PEM)</Text>
            <Text style={styles.codeText}>{deviceIdentity.publicKeyPem}</Text>
          </View>
        ) : null}
      </>
    );
  }

  function renderAudit() {
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>TAMPER-EVIDENT LOG</Text>
          <Text style={styles.heroTitle}>Audit Trail</Text>
          <Text style={styles.heroSubtitle}>
            Every authentication event is hash-chained. Tampering with any entry
            breaks the chain and is detectable.
          </Text>
        </View>

        {/* Audit Status */}
        <View style={styles.detailCard}>
          <DetailRow label="Total Events" value={String(auditCount)} />
          {auditResult ? (
            <>
              <DetailRow
                label="Chain Integrity"
                value={auditResult.valid ? 'VALID' : 'BROKEN'}
                highlight={auditResult.valid ? 'green' : 'red'}
              />
              <DetailRow
                label="Entries Scanned"
                value={String(auditResult.scannedEntries)}
              />
              {auditResult.brokenLogId ? (
                <DetailRow
                  label="Broken At"
                  value={auditResult.brokenLogId}
                  mono
                  highlight="red"
                />
              ) : null}
            </>
          ) : null}
        </View>

        {/* Actions */}
        <View style={styles.auditActions}>
          <TouchableOpacity
            style={[styles.button, auditLoading && styles.buttonDisabled]}
            onPress={handleVerifyAudit}
            disabled={auditLoading}
            accessibilityRole="button"
            accessibilityLabel="Verify audit trail integrity"
          >
            <Text style={styles.buttonText}>
              {auditLoading ? 'Verifying...' : 'Verify Audit Trail'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dangerButton}
            onPress={handleInjectCorruption}
            accessibilityRole="button"
            accessibilityLabel="Inject audit corruption for tamper detection demo"
          >
            <Text style={styles.dangerButtonText}>
              Inject Corruption (Demo)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Explanation */}
        <View style={styles.infoBox}>
          <Text style={styles.infoBoxTitle}>How it works</Text>
          <Text style={styles.infoBoxText}>
            {'Each audit entry contains:\n' +
              '• SHA-256 hash of the event payload\n' +
              '• Hash of the previous entry (chain link)\n' +
              '• Combined current hash = SHA-256(prev_hash + payload_hash)\n\n' +
              'Modifying any entry breaks the chain from that point forward. ' +
              'Use "Inject Corruption" to tamper with the latest entry, then ' +
              '"Verify Audit Trail" to detect it.'}
          </Text>
        </View>
      </>
    );
  }
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} tab`}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CapabilityRow({
  label,
  status,
}: {
  label: string;
  status: 'active' | 'pending';
}) {
  return (
    <View style={styles.capRow}>
      <View
        style={[
          styles.capDot,
          status === 'active' ? styles.capDotActive : styles.capDotPending,
        ]}
      />
      <Text style={styles.capLabel}>{label}</Text>
      <Text
        style={[
          styles.capStatus,
          status === 'active'
            ? styles.capStatusActive
            : styles.capStatusPending,
        ]}
      >
        {status === 'active' ? 'Active' : 'Pending'}
      </Text>
    </View>
  );
}

function DetailRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'green' | 'red';
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          mono && styles.detailValueMono,
          highlight === 'green' && styles.detailValueGreen,
          highlight === 'red' && styles.detailValueRed,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#faf8ff',
  },
  // A5 — State banner
  stateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
    gap: 8,
  },
  stateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stateLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  conflictBadge: {
    backgroundColor: '#e53e3e',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  conflictBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0058be',
    letterSpacing: -0.5,
  },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f2f3ff',
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#565e74',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  hero: {
    marginBottom: 24,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#565e74',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#131b2e',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#565e74',
    lineHeight: 21,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f3ff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
    gap: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#006947',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: '#c2c6d6',
  },
  statusPeers: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0058be',
  },
  alertCard: {
    backgroundColor: '#ffdad6',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
  },
  alertBadge: {
    backgroundColor: 'rgba(147,0,10,0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 12,
  },
  alertBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#93000a',
  },
  alertTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#93000a',
    marginBottom: 8,
  },
  alertDesc: {
    fontSize: 14,
    color: 'rgba(147,0,10,0.8)',
    lineHeight: 21,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#f2f3ff',
    borderRadius: 16,
    padding: 16,
    width: '48%',
    flexGrow: 1,
    flexBasis: '40%',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#131b2e',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#565e74',
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#131b2e',
    marginBottom: 16,
  },
  infoSection: {
    marginBottom: 20,
  },
  capabilityList: {
    gap: 10,
  },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  capDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  capDotActive: {
    backgroundColor: '#006947',
  },
  capDotPending: {
    backgroundColor: '#c2c6d6',
  },
  capLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#131b2e',
  },
  capStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  capStatusActive: {
    color: '#006947',
  },
  capStatusPending: {
    color: '#9da3b0',
  },
  detailCard: {
    backgroundColor: '#f2f3ff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    gap: 12,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: '#565e74',
    fontWeight: '500',
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
    textAlign: 'right',
    flexShrink: 1,
  },
  detailValueMono: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  detailValueGreen: {
    color: '#006947',
  },
  detailValueRed: {
    color: '#93000a',
  },
  codeCard: {
    backgroundColor: '#131b2e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  codeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9da3b0',
    marginBottom: 8,
    letterSpacing: 1,
  },
  codeText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#dae2fd',
    lineHeight: 16,
  },
  auditActions: {
    gap: 12,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#0058be',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#c2c6d6',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  dangerButton: {
    backgroundColor: '#ffdad6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#93000a',
    fontSize: 14,
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: '#f2f3ff',
    borderRadius: 20,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#0058be',
    marginBottom: 20,
  },
  infoBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 8,
  },
  infoBoxText: {
    fontSize: 13,
    color: '#565e74',
    lineHeight: 20,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(250,248,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(19,27,46,0.1)',
    paddingBottom: 24,
  },
  bottomNavContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 4,
  },
  tabBtn: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  tabBtnActive: {
    backgroundColor: '#f2f3ff',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#565e74',
  },
  tabLabelActive: {
    color: '#0058be',
  },
});
