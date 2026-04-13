import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Colors,
  Spacing,
  Radii,
  Typography,
  STATE_META,
  type SystemState,
} from '../theme';

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

/** A5 — System state shown across all tabs (from theme) */

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

  // Pulse animation for the syncing indicator dot
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (systemState === 'syncing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.25,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [systemState, pulseAnim]);

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
          {
            backgroundColor: STATE_META[systemState].bg,
            borderColor: STATE_META[systemState].border,
          },
        ]}
        accessibilityRole="alert"
        accessibilityLabel={`System state: ${STATE_META[systemState].label}${
          conflictCount > 0 ? `, ${conflictCount} conflicts` : ''
        }`}
      >
        <Animated.View
          style={[
            styles.stateDot,
            {
              backgroundColor: STATE_META[systemState].dot,
              opacity: pulseAnim,
            },
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
    backgroundColor: Colors.bgBase,
  },
  // A5 — State banner
  stateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: 1,
  },
  stateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stateLabel: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
    letterSpacing: 0.5,
  },
  conflictBadge: {
    backgroundColor: Colors.orange,
    borderRadius: Radii.pill,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  conflictBadgeText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightBold,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  brandText: {
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
    letterSpacing: -0.5,
  },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logoutText: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  hero: {
    marginBottom: Spacing.lg,
    marginTop: Spacing.md,
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
    fontSize: 32,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  heroSubtitle: {
    fontSize: Typography.fontSizeMd,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgGlass,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignSelf: 'flex-start',
    gap: Spacing.md,
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
    backgroundColor: Colors.verified,
  },
  statusText: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.textPrimary,
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.border,
  },
  statusPeers: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.tealLight,
  },
  alertCard: {
    backgroundColor: Colors.conflictFaint,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderWarn,
  },
  alertBadge: {
    backgroundColor: Colors.orangeFaint,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    marginBottom: Spacing.md,
  },
  alertBadgeText: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightBold,
    letterSpacing: 1.5,
    color: Colors.orange,
  },
  alertTitle: {
    fontSize: Typography.fontSizeXxl,
    fontWeight: Typography.fontWeightBold,
    color: Colors.orangeLight,
    marginBottom: Spacing.sm,
  },
  alertDesc: {
    fontSize: Typography.fontSizeMd,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: Spacing.lg,
  },
  statCard: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    width: '48%',
    flexGrow: 1,
    flexBasis: '40%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    fontWeight: Typography.fontWeightMedium,
  },
  sectionTitle: {
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  infoSection: {
    marginBottom: Spacing.lg,
  },
  capabilityList: {
    gap: Spacing.sm,
  },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  capDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  capDotActive: {
    backgroundColor: Colors.verified,
  },
  capDotPending: {
    backgroundColor: Colors.offline,
  },
  capLabel: {
    flex: 1,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.textPrimary,
  },
  capStatus: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
  },
  capStatusActive: {
    color: Colors.verified,
  },
  capStatusPending: {
    color: Colors.offline,
  },
  detailCard: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailCardTitle: {
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  detailLabel: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    fontWeight: Typography.fontWeightMedium,
    flexShrink: 0,
  },
  detailValue: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemibold,
    color: Colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  detailValueMono: {
    fontFamily: 'monospace',
    fontSize: Typography.fontSizeXs,
    color: Colors.tealLight,
  },
  detailValueGreen: {
    color: Colors.verified,
  },
  detailValueRed: {
    color: Colors.orange,
  },
  codeCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  codeTitle: {
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  codeText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: Colors.tealLight,
    lineHeight: 16,
  },
  auditActions: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  button: {
    backgroundColor: Colors.teal,
    borderRadius: Radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: Colors.bgSurface,
  },
  buttonText: {
    color: Colors.white,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
  },
  dangerButton: {
    backgroundColor: Colors.conflictFaint,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderWarn,
  },
  dangerButtonText: {
    color: Colors.orange,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
  infoBox: {
    backgroundColor: Colors.bgGlass,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.teal,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoBoxTitle: {
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
    color: Colors.tealLight,
    marginBottom: Spacing.sm,
  },
  infoBoxText: {
    fontSize: Typography.fontSizeSm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(5, 13, 20, 0.95)',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 24,
  },
  bottomNavContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    gap: 4,
  },
  tabBtn: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
  },
  tabBtnActive: {
    backgroundColor: Colors.tealFaint,
    borderWidth: 1,
    borderColor: Colors.borderFocus,
  },
  tabLabel: {
    fontSize: Typography.fontSizeXs,
    fontWeight: Typography.fontWeightSemibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  tabLabelActive: {
    color: Colors.tealLight,
  },
});
