/** @jsxImportSource nativewind */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  AuthAuditStatus,
  AuthFailureState,
  AuthOtpChallenge,
  AuthRole,
  AuthenticatedSession,
  DeltaSyncCycleResult,
  DashboardScreenData,
  LoginScreenData,
  MeshRelaySnapshot,
  MeshRoleCycleResult,
  MeshStoreForwardCycleResult,
  RoutingEdgeOverview,
  RoutingOverview,
  RoutingRecomputeResult,
} from '../../../api';
import {
  AUTH_ROLES,
  AuthApi,
  MeshApi,
  RoutingApi,
  SyncApi,
  getAvailableAuthRoles,
  getDashboardScreenData,
  resolveDashboardConflict,
} from '../../../api';
import type { BottomTabScreen } from '../../navigation/contracts';
import {
  ROLE_ALLOWED_SCREENS,
  roleAllowsHandoff,
} from '../../navigation/role-access';

type AuthScreenProps = {
  loginData: LoginScreenData;
  dashboardData: DashboardScreenData;
};

type AuthNotice = {
  tone: 'success' | 'danger' | 'warning' | 'default';
  title: string;
  message: string;
};

type LiveNotification = {
  id: string;
  tone: AuthNotice['tone'];
  title: string;
  message: string;
  occurredAtMs: number;
};

const authApi = new AuthApi();
const syncApi = new SyncApi();
const meshApi = new MeshApi();
const routingApi = new RoutingApi();

const MAIN_TAB_ITEMS: Array<{
  label: string;
  tab: BottomTabScreen;
}> = [
  { label: 'Command', tab: 'Command' },
  { label: 'Inventory', tab: 'Inventory' },
  { label: 'Scanner', tab: 'Scanner' },
  { label: 'Mesh', tab: 'Mesh' },
  { label: 'Identity', tab: 'Identity' },
];

export function AuthScreen({ loginData, dashboardData }: AuthScreenProps) {
  const otpInputRef = useRef<TextInput | null>(null);
  const safeAreaInsets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const availableRoles = useMemo(
    () => getAvailableAuthRoles(loginData),
    [loginData],
  );
  const [selectedRole, setSelectedRole] = useState<AuthRole>(
    availableRoles[0] ?? 'FIELD_VOLUNTEER',
  );
  const [otpChallenge, setOtpChallenge] = useState<AuthOtpChallenge | null>(
    null,
  );
  const [otpCode, setOtpCode] = useState('');
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [activeSession, setActiveSession] =
    useState<AuthenticatedSession | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuthAuditStatus | null>(null);
  const [selectedTab, setSelectedTab] = useState<BottomTabScreen>('Command');
  const [commandSubview, setCommandSubview] = useState<'main' | 'handoff'>(
    'main',
  );
  const [meshThrottleEnabled, setMeshThrottleEnabled] = useState(true);
  const [scanDemoState, setScanDemoState] = useState<
    'idle' | 'success' | 'tamper'
  >('idle');
  const [expandedConflictId, setExpandedConflictId] = useState<string | null>(
    null,
  );
  const [fieldOtpChallenge, setFieldOtpChallenge] =
    useState<AuthOtpChallenge | null>(null);
  const [fieldOtpNowMs, setFieldOtpNowMs] = useState(() => Date.now());
  const [requestingFieldOtp, setRequestingFieldOtp] = useState(false);
  const [auditTerminalLines, setAuditTerminalLines] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [liveDashboardData, setLiveDashboardData] =
    useState<DashboardScreenData>(dashboardData);
  const [liveNotifications, setLiveNotifications] = useState<LiveNotification[]>(
    [],
  );
  const [syncingMesh, setSyncingMesh] = useState(false);
  const [lastSyncCycle, setLastSyncCycle] =
    useState<DeltaSyncCycleResult | null>(null);
  const [evaluatingMeshRole, setEvaluatingMeshRole] = useState(false);
  const [runningStoreForward, setRunningStoreForward] = useState(false);
  const [resumingRelay, setResumingRelay] = useState(false);
  const [meshRoleCycle, setMeshRoleCycle] =
    useState<MeshRoleCycleResult | null>(null);
  const [meshStoreForwardCycle, setMeshStoreForwardCycle] =
    useState<MeshStoreForwardCycleResult | null>(null);
  const [meshRelaySnapshot, setMeshRelaySnapshot] =
    useState<MeshRelaySnapshot | null>(null);
  const [routingOverview, setRoutingOverview] =
    useState<RoutingOverview | null>(null);
  const [lastRoutingRecompute, setLastRoutingRecompute] =
    useState<RoutingRecomputeResult | null>(null);
  const [updatingEdgeId, setUpdatingEdgeId] = useState<string | null>(null);
  const [recomputingActiveRoute, setRecomputingActiveRoute] = useState(false);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(
    null,
  );
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [verifyingAudit, setVerifyingAudit] = useState(false);
  const [injectingAuditCorruption, setInjectingAuditCorruption] =
    useState(false);
  const [keySnapshot, setKeySnapshot] = useState({
    keyProvisioned: loginData.keyProvisioned,
    keyAlgorithm: loginData.keyAlgorithm,
    keyFingerprint: loginData.keyFingerprint,
  });
  const dashboard = liveDashboardData;
  const isWideLayout = width >= 768;
  const routeSummary = dashboard.routes[0];
  const activeRouteOverview =
    routingOverview?.routes.find(route => route.routeId === routeSummary?.routeId) ??
    routingOverview?.routes[0];
  const routingEdges = routingOverview?.edges.slice(0, 6) ?? [];
  const supplySummaries = dashboard.supplies.slice(0, 3);
  const nodeSummaries = dashboard.nodeHealth.slice(0, 3);
  const primaryNodeBatteryPercent = dashboard.nodeHealth[0]?.batteryPercent;
  const triageAlerts = dashboard.triageAlerts.slice(0, 3);
  const allowedScreens = activeSession
    ? ROLE_ALLOWED_SCREENS[activeSession.activeRole]
    : [];
  const primaryButtonLabel = otpChallenge
    ? otpCode.length === 6
      ? 'Verify'
      : 'Enter 6-digit code'
    : 'Get code';
  const syncTimestampLabel = formatZuluTimestamp(
    dashboard.sync.lastSyncedAtMs ?? loginData.lastLoginAtMs,
  );
  const containerClassName = isWideLayout
    ? 'w-full max-w-[760px] self-center px-6'
    : 'px-4';

  useEffect(() => {
    setSelectedRole(availableRoles[0] ?? 'FIELD_VOLUNTEER');
  }, [availableRoles]);

  useEffect(() => {
    setKeySnapshot({
      keyProvisioned: loginData.keyProvisioned,
      keyAlgorithm: loginData.keyAlgorithm,
      keyFingerprint: loginData.keyFingerprint,
    });
  }, [loginData]);

  useEffect(() => {
    setLiveDashboardData(dashboardData);
  }, [dashboardData]);

  useEffect(() => {
    let isActive = true;

    const pollDashboard = async () => {
      try {
        const nextDashboard = await getDashboardScreenData();
        if (!isActive) {
          return;
        }

        setLiveDashboardData(previousDashboard => {
          emitRealtimeNotifications(previousDashboard, nextDashboard);
          return nextDashboard;
        });
      } catch {
        // Keep local state when polling fails; this must not block offline usage.
      }
    };

    const timerId = setInterval(pollDashboard, 4000);

    return () => {
      isActive = false;
      clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    let disposed = false;

    const pollRoutingOverview = async () => {
      try {
        const nextOverview = await routingApi.getRoutingOverview();
        if (disposed) {
          return;
        }

        setRoutingOverview(nextOverview);
      } catch {
        // Routing overview polling must not block core auth/sync interactions.
      }
    };

    void pollRoutingOverview();
    const timerId = setInterval(pollRoutingOverview, 5000);

    return () => {
      disposed = true;
      clearInterval(timerId);
    };
  }, [activeSession]);

  useEffect(() => {
    if (!otpChallenge) {
      return;
    }

    const timerId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timerId);
  }, [otpChallenge]);

  useEffect(() => {
    if (!fieldOtpChallenge) {
      return;
    }

    const timerId = setInterval(() => {
      setFieldOtpNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timerId);
  }, [fieldOtpChallenge]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const allowed = ROLE_ALLOWED_SCREENS[activeSession.activeRole];
    if (!allowed.includes(selectedTab)) {
      setSelectedTab(allowed[0] ?? 'Command');
    }
  }, [activeSession, selectedTab]);

  useEffect(() => {
    if (!activeSession || selectedTab !== 'Mesh') {
      return;
    }

    void refreshMeshSnapshot();
  }, [activeSession, selectedTab]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    let disposed = false;

    const autoEvaluateRole = async () => {
      try {
        const batteryBaseline = primaryNodeBatteryPercent ?? 74;
        const result = await meshApi.evaluateNodeRole({
          loginData,
          session: activeSession,
          batteryPercent: meshThrottleEnabled
            ? Math.max(18, batteryBaseline - 20)
            : batteryBaseline,
          signalStrength: estimateSignalStrength(dashboard),
          nearbyPeerCount: dashboard.sync.peerCount,
        });

        if (disposed) {
          return;
        }

        setMeshRoleCycle(result);

        if (result.changed) {
          pushLiveNotification({
            tone: 'success',
            title: 'Auto role switch',
            message: `${result.previousRole ?? 'unknown'} -> ${result.role} · score ${result.relayScore.toFixed(1)}`,
          });
          await refreshMeshSnapshot();
        }
      } catch {
        // Automatic role checks should not interrupt the UI workflow.
      }
    };

    void autoEvaluateRole();
    const timerId = setInterval(() => {
      void autoEvaluateRole();
    }, 12000);

    return () => {
      disposed = true;
      clearInterval(timerId);
    };
  }, [
    activeSession,
    dashboard.connectivityState,
    dashboard.sync.peerCount,
    loginData,
    meshThrottleEnabled,
    primaryNodeBatteryPercent,
  ]);

  const remainingSeconds = otpChallenge
    ? Math.max(0, Math.ceil((otpChallenge.expiresAtMs - nowMs) / 1000))
    : 0;
  const fieldOtpRemainingSeconds = fieldOtpChallenge
    ? Math.max(
        0,
        Math.ceil((fieldOtpChallenge.expiresAtMs - fieldOtpNowMs) / 1000),
      )
    : 0;

  function pushLiveNotification(input: {
    tone: LiveNotification['tone'];
    title: string;
    message: string;
  }) {
    const event: LiveNotification = {
      id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tone: input.tone,
      title: input.title,
      message: input.message,
      occurredAtMs: Date.now(),
    };

    setLiveNotifications(previous => [event, ...previous].slice(0, 24));
  }

  function emitRealtimeNotifications(
    previousDashboard: DashboardScreenData,
    nextDashboard: DashboardScreenData,
  ) {
    if (previousDashboard.connectivityState !== nextDashboard.connectivityState) {
      pushLiveNotification({
        tone:
          nextDashboard.connectivityState === 'verified'
            ? 'success'
            : nextDashboard.connectivityState === 'conflict-detected'
              ? 'warning'
              : 'default',
        title: 'Connectivity state updated',
        message: `${formatConnectivityLabel(previousDashboard.connectivityState)} -> ${formatConnectivityLabel(nextDashboard.connectivityState)}`,
      });
    }

    if (
      nextDashboard.sync.lastSyncedAtMs &&
      nextDashboard.sync.lastSyncedAtMs !== previousDashboard.sync.lastSyncedAtMs
    ) {
      pushLiveNotification({
        tone: 'success',
        title: 'Sync verified',
        message: `Last synced ${formatZuluTimestamp(nextDashboard.sync.lastSyncedAtMs)}`,
      });
    }

    if (
      nextDashboard.sync.queuedEnvelopeCount !==
        previousDashboard.sync.queuedEnvelopeCount ||
      nextDashboard.sync.inFlightEnvelopeCount !==
        previousDashboard.sync.inFlightEnvelopeCount
    ) {
      pushLiveNotification({
        tone: 'default',
        title: 'Sync queue changed',
        message: `Queued ${nextDashboard.sync.queuedEnvelopeCount} · In flight ${nextDashboard.sync.inFlightEnvelopeCount}`,
      });
    }

    const unresolvedBefore = previousDashboard.conflicts.filter(
      conflict => !conflict.resolvedAtMs,
    ).length;
    const unresolvedNow = nextDashboard.conflicts.filter(
      conflict => !conflict.resolvedAtMs,
    ).length;

    if (unresolvedNow > unresolvedBefore) {
      pushLiveNotification({
        tone: 'warning',
        title: 'New conflict detected',
        message: `${unresolvedNow} unresolved conflict${unresolvedNow === 1 ? '' : 's'}`,
      });
    }

    if (unresolvedNow < unresolvedBefore) {
      pushLiveNotification({
        tone: 'success',
        title: 'Conflict resolved',
        message: `${unresolvedNow} unresolved conflict${unresolvedNow === 1 ? '' : 's'} remaining`,
      });
    }

    const previousRoute = previousDashboard.routes[0];
    const nextRoute = nextDashboard.routes[0];
    if (
      nextRoute &&
      (!previousRoute ||
        previousRoute.routeId !== nextRoute.routeId ||
        previousRoute.etaMinutes !== nextRoute.etaMinutes ||
        previousRoute.totalRiskScore !== nextRoute.totalRiskScore ||
        previousRoute.computedAtMs !== nextRoute.computedAtMs)
    ) {
      pushLiveNotification({
        tone: 'success',
        title: 'Route recomputed',
        message: `${nextRoute.deliveryId} · ETA ${nextRoute.etaMinutes ?? '—'}m · risk ${formatRisk(nextRoute.totalRiskScore)}`,
      });
    }
  }

  async function handleRequestOtp() {
    setRequestingOtp(true);
    setAuthNotice(null);

    try {
      const challenge = await authApi.requestOtp({
        loginData,
        selectedRole,
      });

      setOtpChallenge(challenge);
      setOtpCode('');
      setAuthNotice({
        tone: 'success',
        title: 'Code issued',
        message: 'Use the alert dialog or enter the code below.',
      });
      pushLiveNotification({
        tone: 'success',
        title: 'OTP issued',
        message: `Role ${formatRoleLabel(challenge.requestedRole)} · expires in ${Math.max(0, Math.ceil((challenge.expiresAtMs - Date.now()) / 1000))}s`,
      });
      notifyOtpCode(challenge);
      setNowMs(Date.now());
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Unable to issue OTP',
        message:
          error instanceof Error
            ? error.message
            : 'The auth service could not issue an OTP.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'OTP request failed',
        message:
          error instanceof Error
            ? error.message
            : 'The auth service could not issue an OTP.',
      });
    } finally {
      setRequestingOtp(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpChallenge) {
      setAuthNotice({
        tone: 'warning',
        title: 'No active code',
        message: 'Request a code first.',
      });
      return;
    }

    if (otpCode.trim().length !== 6) {
      setAuthNotice({
        tone: 'warning',
        title: 'Invalid length',
        message: 'Enter all 6 digits.',
      });
      return;
    }

    setVerifyingOtp(true);

    try {
      const result = await authApi.verifyOtp({
        loginData,
        otpSession: otpChallenge,
        otpCode,
      });

      if (!result.ok) {
        applyFailureNotice(result.error);
        return;
      }

      setActiveSession(result.session);
      setSelectedTab(
        ROLE_ALLOWED_SCREENS[result.session.activeRole][0] ?? 'Command',
      );
      setCommandSubview('main');
      setOtpChallenge(null);
      setOtpCode('');
      setAuthNotice({
        tone: 'success',
        title: 'Signed in',
        message: `Session active · ${formatRoleLabel(result.session.activeRole)}`,
      });
      pushLiveNotification({
        tone: 'success',
        title: 'Login verified',
        message: `${formatRoleLabel(result.session.activeRole)} access granted`,
      });
      setKeySnapshot(previousSnapshot => ({
        keyProvisioned: true,
        keyAlgorithm:
          result.session.keyAlgorithm ?? previousSnapshot.keyAlgorithm,
        keyFingerprint:
          result.session.keyFingerprint ?? previousSnapshot.keyFingerprint,
      }));
      setAuditTerminalLines(previous =>
        [
          ...previous,
          `[${new Date().toISOString()}] VERIFY_OK role=${result.session.activeRole} session=${result.session.authEventId}`,
        ].slice(-48),
      );
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Verification failed',
        message:
          error instanceof Error
            ? error.message
            : 'The auth service could not verify the OTP.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'OTP verification failed',
        message:
          error instanceof Error
            ? error.message
            : 'The auth service could not verify the OTP.',
      });
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function handleRotateKey() {
    setRotatingKey(true);

    try {
      const identity = await authApi.rotateDeviceKey({ loginData });
      setKeySnapshot({
        keyProvisioned: true,
        keyAlgorithm: identity.keyAlgorithm,
        keyFingerprint: identity.keyFingerprint,
      });
      setAuthNotice({
        tone: 'success',
        title: 'Key rotated',
        message: 'New device key stored and registered.',
      });
      pushLiveNotification({
        tone: 'success',
        title: 'Device key rotated',
        message: identity.keyFingerprint,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Key rotation failed',
        message:
          error instanceof Error
            ? error.message
            : 'The secure key vault could not rotate the device key.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Key rotation failed',
        message:
          error instanceof Error
            ? error.message
            : 'The secure key vault could not rotate the device key.',
      });
    } finally {
      setRotatingKey(false);
    }
  }

  async function handleVerifyAuditTrail() {
    setVerifyingAudit(true);

    try {
      const nextAuditStatus = await authApi.verifyAuditTrail({ loginData });
      setAuditStatus(nextAuditStatus);
      setAuditTerminalLines(previous =>
        [
          ...previous,
          `[${new Date().toISOString()}] AUDIT_SCAN valid=${String(
            nextAuditStatus.valid,
          )} entries=${nextAuditStatus.scannedEntries}${
            nextAuditStatus.brokenLogId
              ? ` break=${nextAuditStatus.brokenLogId}`
              : ''
          }`,
        ].slice(-48),
      );
      setAuthNotice({
        tone: nextAuditStatus.valid ? 'success' : 'danger',
        title: nextAuditStatus.valid
          ? 'Audit trail verified'
          : 'Audit corruption detected',
        message: nextAuditStatus.valid
          ? `${nextAuditStatus.scannedEntries} entries OK`
          : `Broken chain at ${nextAuditStatus.brokenLogId ?? 'unknown'}`,
      });
      pushLiveNotification({
        tone: nextAuditStatus.valid ? 'success' : 'danger',
        title: nextAuditStatus.valid ? 'Audit chain verified' : 'Audit chain failed',
        message: nextAuditStatus.valid
          ? `${nextAuditStatus.scannedEntries} entries checked`
          : `Broken at ${nextAuditStatus.brokenLogId ?? 'unknown'}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Audit verification failed',
        message:
          error instanceof Error
            ? error.message
            : 'The audit chain could not be checked.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Audit verification failed',
        message:
          error instanceof Error
            ? error.message
            : 'The audit chain could not be checked.',
      });
    } finally {
      setVerifyingAudit(false);
    }
  }

  async function handleInjectAuditCorruption() {
    setInjectingAuditCorruption(true);

    try {
      const result = await authApi.injectAuditCorruptionForDemo({ loginData });
      setAuditStatus(null);
      if (result.corrupted && result.logId) {
        setAuditTerminalLines(previous =>
          [
            ...previous,
            `[${new Date().toISOString()}] AUDIT_INJECT tamper_target=${result.logId}`,
          ].slice(-48),
        );
      }
      setAuthNotice({
        tone: result.corrupted ? 'warning' : 'default',
        title: result.corrupted
          ? 'Audit corruption injected'
          : 'No audit log to corrupt',
        message: result.corrupted
          ? `Entry ${result.logId} modified. Run verify.`
          : 'No audit entries.',
      });
      pushLiveNotification({
        tone: result.corrupted ? 'warning' : 'default',
        title: result.corrupted ? 'Audit tamper injected' : 'No audit entry available',
        message: result.corrupted
          ? `Target ${result.logId}`
          : 'No audit entries to corrupt.',
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Audit corruption failed',
        message:
          error instanceof Error
            ? error.message
            : 'The demo corruption step could not be applied.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Tamper injection failed',
        message:
          error instanceof Error
            ? error.message
            : 'The demo corruption step could not be applied.',
      });
    } finally {
      setInjectingAuditCorruption(false);
    }
  }

  async function handleResolveConflict(
    conflictId: string,
    resolution: 'local' | 'remote' | 'merged' | 'manual',
  ) {
    if (!activeSession) {
      return;
    }

    setResolvingConflictId(conflictId);

    try {
      await resolveDashboardConflict({
        conflictId,
        resolution,
        actor: {
          userId: activeSession.userId,
          deviceId: activeSession.deviceId,
          role: activeSession.activeRole,
        },
      });

      const refreshedDashboard = await getDashboardScreenData();
      setLiveDashboardData(previousDashboard => {
        emitRealtimeNotifications(previousDashboard, refreshedDashboard);
        return refreshedDashboard;
      });

      setAuthNotice({
        tone: 'success',
        title: 'Conflict resolved',
        message: `${conflictId} resolved using ${resolution}.`,
      });
      pushLiveNotification({
        tone: 'success',
        title: 'Conflict resolution committed',
        message: `${conflictId} -> ${resolution}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Conflict resolution failed',
        message:
          error instanceof Error
            ? error.message
            : 'Could not resolve the selected conflict.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Conflict resolution failed',
        message:
          error instanceof Error
            ? error.message
            : 'Could not resolve the selected conflict.',
      });
    } finally {
      setResolvingConflictId(null);
    }
  }

  async function refreshMeshSnapshot() {
    if (!activeSession) {
      return;
    }

    try {
      const snapshot = await meshApi.getRelaySnapshot({
        loginData,
        session: activeSession,
        limit: 18,
      });
      setMeshRelaySnapshot(snapshot);
    } catch {
      // Mesh telemetry is best-effort and should not break the screen.
    }
  }

  async function handleEvaluateMeshRole() {
    if (!activeSession) {
      return;
    }

    setEvaluatingMeshRole(true);

    try {
      const batteryBaseline = dashboard.nodeHealth[0]?.batteryPercent ?? 74;
      const result = await meshApi.evaluateNodeRole({
        loginData,
        session: activeSession,
        batteryPercent: meshThrottleEnabled
          ? Math.max(18, batteryBaseline - 20)
          : batteryBaseline,
        signalStrength: estimateSignalStrength(dashboard),
        nearbyPeerCount: dashboard.sync.peerCount,
      });

      setMeshRoleCycle(result);
      await refreshMeshSnapshot();

      setAuthNotice({
        tone: result.changed ? 'success' : 'default',
        title: result.changed ? 'Mesh role switched' : 'Mesh role unchanged',
        message: `Role ${result.role.toUpperCase()} · score ${result.relayScore.toFixed(1)} · battery ${result.batteryPercent}% · signal ${result.signalStrength}%`,
      });
      pushLiveNotification({
        tone: result.changed ? 'success' : 'default',
        title: 'Role heuristic evaluated',
        message: `${result.previousRole ?? 'unknown'} -> ${result.role} · score ${result.relayScore.toFixed(1)}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Mesh role evaluation failed',
        message:
          error instanceof Error
            ? error.message
            : 'Role heuristic execution failed.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Mesh role evaluation failed',
        message:
          error instanceof Error
            ? error.message
            : 'Role heuristic execution failed.',
      });
    } finally {
      setEvaluatingMeshRole(false);
    }
  }

  async function handleRunStoreForward(options: {
    relayOnline: boolean;
    recipientOnline: boolean;
  }) {
    if (!activeSession) {
      return;
    }

    setRunningStoreForward(true);

    try {
      const cycle = await meshApi.runStoreForwardCycle({
        loginData,
        session: activeSession,
        relayDeviceId: meshRelaySnapshot?.devices.relayDeviceId,
        recipientDeviceId: meshRelaySnapshot?.devices.recipientDeviceId,
        relayOnline: options.relayOnline,
        recipientOnline: options.recipientOnline,
      });

      setMeshStoreForwardCycle(cycle);
      await refreshMeshSnapshot();

      const tone: AuthNotice['tone'] = cycle.delivered
        ? 'success'
        : cycle.relayStored || !options.relayOnline
          ? 'warning'
          : 'default';
      setAuthNotice({
        tone,
        title: cycle.delivered
          ? 'Store-forward delivered'
          : 'Store-forward queued',
        message: `Packet ${cycle.packetId} · sender ${cycle.senderDispatches} · relay ${cycle.relayDispatches} · delivered ${String(cycle.delivered)}`,
      });
      pushLiveNotification({
        tone,
        title: 'Store-forward cycle executed',
        message: `relayOnline=${String(options.relayOnline)} · recipientOnline=${String(options.recipientOnline)} · delivered=${String(cycle.delivered)}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Store-forward failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to run encrypted store-forward cycle.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Store-forward failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to run encrypted store-forward cycle.',
      });
    } finally {
      setRunningStoreForward(false);
    }
  }

  async function handleResumeRelayForwarding() {
    if (!activeSession) {
      return;
    }

    const relayDeviceId = meshRelaySnapshot?.devices.relayDeviceId;
    if (!relayDeviceId) {
      setAuthNotice({
        tone: 'warning',
        title: 'No relay node selected',
        message: 'Evaluate role or run one cycle to discover relay peers.',
      });
      return;
    }

    setResumingRelay(true);

    try {
      const result = await meshApi.resumeRelayForwarding({
        senderDeviceId: activeSession.deviceId,
        relayDeviceId,
        recipientDeviceId: meshRelaySnapshot?.devices.recipientDeviceId,
        recipientOnline: true,
      });

      await refreshMeshSnapshot();

      setAuthNotice({
        tone: result.delivered ? 'success' : 'default',
        title: result.delivered
          ? 'Relay resumed and delivered'
          : 'Relay resumed',
        message: `Sender ${result.senderDispatches} · relay ${result.relayDispatches} · delivered ${String(result.delivered)}`,
      });
      pushLiveNotification({
        tone: result.delivered ? 'success' : 'default',
        title: 'Relay forwarding resumed',
        message: `sender=${result.senderDispatches} · relay=${result.relayDispatches} · delivered=${String(result.delivered)}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Relay resume failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to resume relay forwarding.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Relay resume failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to resume relay forwarding.',
      });
    } finally {
      setResumingRelay(false);
    }
  }

  async function handleRunMeshSync() {
    if (!activeSession) {
      return;
    }

    setSyncingMesh(true);

    try {
      const result = await syncApi.runDeltaSyncCycle({
        loginData,
        session: activeSession,
        transport: 'bluetooth_le',
        listenWindowMs: 5000,
      });

      setLastSyncCycle(result);

      const refreshedDashboard = await getDashboardScreenData();
      setLiveDashboardData(previousDashboard => {
        emitRealtimeNotifications(previousDashboard, refreshedDashboard);
        return refreshedDashboard;
      });

      setAuthNotice({
        tone: result.conflictsDetected > 0 ? 'warning' : 'success',
        title:
          result.conflictsDetected > 0
            ? 'Sync completed with conflicts'
            : 'Sync completed',
        message: `Peer ${result.peerDeviceId} · Exported ${result.exportedEventCount} · Imported ${result.importedEventCount} · ${result.envelopeSizeBytes} bytes · BLE ${result.transportSent ? 'sent' : 'pending'}`,
      });
      pushLiveNotification({
        tone: result.conflictsDetected > 0 ? 'warning' : 'success',
        title: 'Delta sync cycle finished',
        message: `${result.transport} · sent=${String(result.transportSent)} · exported ${result.exportedEventCount} · imported ${result.importedEventCount} · conflicts ${result.conflictsDetected}`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Sync failed',
        message:
          error instanceof Error
            ? error.message
            : 'Sync engine failed to complete this cycle.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Sync failed',
        message:
          error instanceof Error
            ? error.message
            : 'Sync engine failed to complete this cycle.',
      });
    } finally {
      setSyncingMesh(false);
    }
  }

  async function refreshRoutingOverview() {
    try {
      const overview = await routingApi.getRoutingOverview();
      setRoutingOverview(overview);
    } catch {
      // Routing view refresh is best-effort and should not block user flow.
    }
  }

  async function handleUpdateRouteEdgeStatus(input: {
    edge: RoutingEdgeOverview;
    status: RoutingEdgeOverview['status'];
  }) {
    if (!activeSession) {
      return;
    }

    setUpdatingEdgeId(input.edge.edgeId);

    try {
      const riskScore =
        input.status === 'washed_out' || input.status === 'impassable'
          ? Math.max(input.edge.riskScore, 0.98)
          : input.status === 'degraded'
            ? Math.max(input.edge.riskScore, 0.55)
            : input.edge.riskScore;
      const travelTimeMinutes =
        input.status === 'washed_out' || input.status === 'impassable'
          ? 9_999
          : input.status === 'degraded'
            ? Math.max(input.edge.travelTimeMinutes, Math.round(input.edge.travelTimeMinutes * 1.35))
            : input.edge.travelTimeMinutes;

      const result = await routingApi.updateEdgeStatusAndRecompute({
        loginData,
        session: activeSession,
        edgeId: input.edge.edgeId,
        status: input.status,
        riskScore,
        travelTimeMinutes,
      });
      setLastRoutingRecompute(result);

      const [refreshedDashboard] = await Promise.all([
        getDashboardScreenData(),
        refreshRoutingOverview(),
      ]);

      setLiveDashboardData(previousDashboard => {
        emitRealtimeNotifications(previousDashboard, refreshedDashboard);
        return refreshedDashboard;
      });

      setAuthNotice({
        tone: result.withinTwoSeconds ? 'success' : 'warning',
        title: 'Route graph updated',
        message: `${input.edge.edgeId} -> ${formatStatusLabel(input.status)} · recompute ${result.recomputeDurationMs}ms · affected ${result.affectedRoutes.length}`,
      });
      pushLiveNotification({
        tone: result.withinTwoSeconds ? 'success' : 'warning',
        title: 'Edge status changed',
        message: `${input.edge.edgeId} ${formatStatusLabel(input.status)} · ${result.recomputeDurationMs}ms`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Edge update failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to update edge status and recompute routes.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Route update failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to update edge status and recompute routes.',
      });
    } finally {
      setUpdatingEdgeId(null);
    }
  }

  async function handleRecomputeActiveRoute() {
    if (!activeSession || !routeSummary?.routeId) {
      return;
    }

    setRecomputingActiveRoute(true);

    try {
      const startedAtMs = Date.now();
      const recomputedRoute = await routingApi.recomputeRoute({
        loginData,
        session: activeSession,
        routeId: routeSummary.routeId,
      });
      const durationMs = Date.now() - startedAtMs;

      setLastRoutingRecompute({
        edgeId: 'manual-recompute',
        updatedStatus: 'open',
        updatedAtMs: Date.now(),
        recomputeDurationMs: durationMs,
        withinTwoSeconds: durationMs <= 2_000,
        affectedRoutes: [recomputedRoute],
        routeEventIds: [],
        edgeEventId: 'manual-recompute',
      });

      const [refreshedDashboard] = await Promise.all([
        getDashboardScreenData(),
        refreshRoutingOverview(),
      ]);

      setLiveDashboardData(previousDashboard => {
        emitRealtimeNotifications(previousDashboard, refreshedDashboard);
        return refreshedDashboard;
      });

      setAuthNotice({
        tone: durationMs <= 2_000 ? 'success' : 'warning',
        title: 'Route recomputed',
        message: `${recomputedRoute.routeId} recalculated in ${durationMs}ms · ETA ${recomputedRoute.totalEtaMinutes}m`,
      });
      pushLiveNotification({
        tone: durationMs <= 2_000 ? 'success' : 'warning',
        title: 'Manual route recompute',
        message: `${recomputedRoute.routeId} · ${durationMs}ms`,
      });
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Route recompute failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to recompute the active route.',
      });
      pushLiveNotification({
        tone: 'danger',
        title: 'Manual recompute failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to recompute the active route.',
      });
    } finally {
      setRecomputingActiveRoute(false);
    }
  }

  function handleSignOut() {
    setOtpChallenge(null);
    setOtpCode('');
    setAuthNotice(null);
    setActiveSession(null);
    setAuditStatus(null);
    setSelectedRole(availableRoles[0] ?? 'FIELD_VOLUNTEER');
    setSelectedTab('Command');
    setCommandSubview('main');
    setFieldOtpChallenge(null);
    setScanDemoState('idle');
    setExpandedConflictId(null);
    setAuditTerminalLines([]);
    setLiveNotifications([]);
    setLastSyncCycle(null);
    setMeshRoleCycle(null);
    setMeshStoreForwardCycle(null);
    setMeshRelaySnapshot(null);
    setRoutingOverview(null);
    setLastRoutingRecompute(null);
    setUpdatingEdgeId(null);
    setRecomputingActiveRoute(false);
    setKeySnapshot({
      keyProvisioned: loginData.keyProvisioned,
      keyAlgorithm: loginData.keyAlgorithm,
      keyFingerprint: loginData.keyFingerprint,
    });
  }

  async function handleRequestFieldOtp() {
    if (!activeSession) {
      return;
    }

    setRequestingFieldOtp(true);
    setAuthNotice(null);

    try {
      const challenge = await authApi.requestOtp({
        loginData,
        selectedRole: activeSession.activeRole,
      });
      setFieldOtpChallenge(challenge);
      setFieldOtpNowMs(Date.now());
      setAuthNotice({
        tone: 'success',
        title: 'Code issued',
        message: 'Shown below and in the alert.',
      });
      notifyOtpCode(challenge);
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Unable to issue field code',
        message:
          error instanceof Error
            ? error.message
            : 'The auth service could not issue an OTP.',
      });
    } finally {
      setRequestingFieldOtp(false);
    }
  }

  async function handlePrimaryAccessAction() {
    if (!otpChallenge || remainingSeconds === 0) {
      await handleRequestOtp();
      return;
    }

    await handleVerifyOtp();
  }

  function openOtpInput() {
    otpInputRef.current?.focus();
  }

  if (!activeSession) {
    return (
      <ScrollView
        className="flex-1 bg-[#071220]"
        keyboardShouldPersistTaps="handled"
      >
        <View className={`w-full pb-8 pt-4 ${containerClassName}`}>
          {renderLoginScreen()}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-[#071220]">
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
      >
        <View className={`w-full pt-4 ${containerClassName}`}>
          <View className="gap-5 pb-4">
            {renderBrandHeader()}

            <View className="border-b border-[#1D2D46] pb-4">
              <Text className="text-[20px] font-semibold text-[#E4EBFA]">
                {activeSession.displayName}
              </Text>
              <Text className="mt-1 text-[13px] text-[#8FA0BC]">
                {formatRoleLabel(activeSession.activeRole)} ·{' '}
                {loginData.userId}
              </Text>
              <Text className="mt-2 text-[12px] text-[#6B7A92]">
                Sync {syncTimestampLabel}
              </Text>
            </View>

            {authNotice ? renderNoticeCard() : null}
            {renderLiveNotifications()}

            {selectedTab === 'Command' ? renderCommandTab() : null}
            {selectedTab === 'Inventory' ? renderInventoryTab() : null}
            {selectedTab === 'Scanner' ? renderScannerTab() : null}
            {selectedTab === 'Mesh' ? renderMeshTab() : null}
            {selectedTab === 'Identity' ? renderIdentityTab() : null}
          </View>
        </View>
      </ScrollView>

      <View
        className="border-t border-[#1D2D46] bg-[#0a1422]"
        style={{
          paddingBottom: Math.max(safeAreaInsets.bottom, 8),
          paddingTop: 8,
        }}
      >
        <View className="flex-row items-stretch justify-between gap-1 px-1">
          {MAIN_TAB_ITEMS.map(item => {
            const allowed = allowedScreens.includes(item.tab);
            const selected = selectedTab === item.tab;

            return (
              <Pressable
                key={item.tab}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.label} tab`}
                disabled={!allowed}
                onPress={() => {
                  setSelectedTab(item.tab);
                  if (item.tab !== 'Command') {
                    setCommandSubview('main');
                  }
                }}
                className={buildNavItemClassName({ allowed, selected })}
              >
                <Text
                  className={buildNavItemTextClassName({ allowed, selected })}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  function applyFailureNotice(error: AuthFailureState) {
    setActiveSession(null);
    setAuthNotice({
      tone: error.code === 'ACCESS_DENIED' ? 'warning' : 'danger',
      title: error.title,
      message: error.message,
    });
    pushLiveNotification({
      tone: error.code === 'ACCESS_DENIED' ? 'warning' : 'danger',
      title: error.title,
      message: error.message,
    });
  }

  function notifyOtpCode(challenge: AuthOtpChallenge) {
    const title = 'OTP';
    const message = [
      formatRoleLabel(challenge.requestedRole),
      challenge.demoCode,
      `Expires ${new Date(challenge.expiresAtMs).toLocaleTimeString()}`,
    ].join('\n');

    if (Platform.OS === 'android') {
      ToastAndroid.show('OTP ready', ToastAndroid.SHORT);
    }

    Alert.alert(title, message);
  }

  function renderLoginScreen() {
    return (
      <View className="gap-6">
        {renderBrandHeader()}

        <Text className="text-[22px] font-semibold text-[#E4EBFA]">Sign in</Text>

        <View className="rounded-2xl border border-[#1D2D46] bg-[#111D30] p-5">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Account
          </Text>
          <Text className="mt-2 text-[15px] text-[#E7EEFC]">{loginData.userId}</Text>
          <Text className="mt-1 text-[14px] text-[#9EB0D0]">{loginData.displayName}</Text>
          <Text className="mt-3 text-[12px] text-[#6B7A92]">Device {loginData.deviceId}</Text>

          <View className="my-4 h-px bg-[#24324A]" />

          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Device key
          </Text>
          <Text className="mt-2 text-[14px] text-[#D7E0F3]">
            {keySnapshot.keyProvisioned ? 'Provisioned' : 'Pending first sign-in'}
          </Text>
          <Text className="mt-1 text-[12px] text-[#8FA0BC]">
            {(keySnapshot.keyAlgorithm ?? 'ed25519').toUpperCase()}
          </Text>

          <View className="my-4 h-px bg-[#24324A]" />

          <View className="flex-row items-center justify-between">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              Role
            </Text>
            <Text className="text-[12px] text-[#9EB0D0]">
              {formatConnectivityLabel(dashboard.connectivityState)}
            </Text>
          </View>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {AUTH_ROLES.map(role => {
              const allowed = availableRoles.includes(role);
              const selected = selectedRole === role;

              return (
                <Pressable
                  key={role}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${formatRoleLabel(role)} role`}
                  disabled={!allowed}
                  onPress={() => setSelectedRole(role)}
                  className={buildRoleChipClassName({ allowed, selected })}
                >
                  <Text
                    className={buildRoleChipTextClassName({
                      allowed,
                      selected,
                    })}
                  >
                    {formatRoleLabel(role)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="my-4 h-px bg-[#24324A]" />

          <View className="flex-row items-center justify-between">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              One-time password
            </Text>
            <Text className="text-[12px] text-[#C9A27A]">
              {otpChallenge ? `${remainingSeconds}s` : '—'}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Focus OTP entry"
            onPress={openOtpInput}
            className="mt-3 flex-row justify-between gap-2"
          >
            {renderOtpSlots(otpCode)}
          </Pressable>

          <TextInput
            ref={otpInputRef}
            accessibilityLabel="OTP digits"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={value => setOtpCode(value.replace(/[^0-9]/g, ''))}
            value={otpCode}
            className="h-0 w-0 opacity-0"
          />

          <Text className="mt-3 text-[12px] leading-5 text-[#6B7A92]">
            Code is shown in the alert after &quot;Get code&quot;. Enter it here
            to verify.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={primaryButtonLabel}
            disabled={requestingOtp || verifyingOtp}
            onPress={handlePrimaryAccessAction}
            className={`mt-5 min-h-[52px] items-center justify-center rounded-lg bg-[#BFD0F7] px-5 ${
              requestingOtp || verifyingOtp ? 'opacity-60' : ''
            }`}
          >
            <Text className="text-[15px] font-semibold text-[#102950]">
              {requestingOtp
                ? 'Requesting…'
                : verifyingOtp
                  ? 'Verifying…'
                  : primaryButtonLabel}
            </Text>
          </Pressable>

          <View className="mt-5 flex-row justify-between border-t border-[#24324A] pt-4">
            <Text className="text-[12px] text-[#6B7A92]">Last sync</Text>
            <Text className="text-[12px] text-[#B8C4DA]">{syncTimestampLabel}</Text>
          </View>
        </View>

        {authNotice ? renderNoticeCard() : null}
        {renderLiveNotifications()}
      </View>
    );
  }

  function renderCommandTab() {
    if (!activeSession) {
      return null;
    }

    if (commandSubview === 'handoff') {
      return renderHandoffView();
    }

    const riskScore = routeSummary?.totalRiskScore;
    const routeFailureLikely =
      typeof riskScore === 'number' && riskScore > 0.35 ? 'elevated' : 'nominal';

    return (
      <View className="gap-4">
        <Text className="text-[12px] text-[#6B7A92]">
          Modes: road · water · air · cached map tiles · recompute{' '}
          {lastRoutingRecompute
            ? `${lastRoutingRecompute.recomputeDurationMs}ms`
            : 'idle'}
        </Text>

        <View className="overflow-hidden rounded-2xl bg-[#8B4513] px-4 py-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#FFE5D1]">
            Triage
          </Text>
          <Text className="mt-2 text-[16px] font-semibold leading-6 text-white">
            {buildThreatHeadline(routeSummary, triageAlerts[0])}
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-[#FFF2E8]">
            {triageAlerts[0]?.rationale ?? 'No triage data.'}
          </Text>
        </View>

        {dashboard.triageAlerts.slice(1).map(alert => (
          <View
            key={`triage-${alert.deliveryId}-${alert.decidedAtMs}`}
            className="rounded-xl border border-[#5C3D28] bg-[#2A1E16] px-4 py-3"
          >
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#E6A786]">
              Triage
            </Text>
            <Text className="mt-1 text-[14px] font-medium text-[#F3F6FD]">
              {alert.highestRemainingPriority} · {alert.deliveryId}
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-[#D4DDEA]">
              {alert.rationale}
            </Text>
          </View>
        ))}

        <View className="rounded-xl border border-[#1E304A] bg-[#131E31] p-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Map
          </Text>
          <View className="mt-2 h-[140px] overflow-hidden rounded-lg bg-[#0A1220]">
            <View className="absolute left-6 top-6 h-2 w-2 rounded-full bg-[#E9EEF9]" />
            <View className="absolute left-14 top-6 h-2 w-2 rounded-full bg-[#C2D0EE]" />
            <View className="absolute bottom-8 right-10 h-2 w-2 rounded-full bg-[#E9EEF9]" />
            <View className="absolute left-8 top-8 h-[2px] w-[180px] rotate-[18deg] bg-[#65789C]" />
            <View className="absolute left-24 top-14 h-[2px] w-[130px] rotate-[-32deg] bg-[#435270]" />
            <View className="absolute right-3 top-3 rounded bg-[#202C42] px-2 py-1">
              <Text className="text-[10px] font-medium text-[#CFD8EB]">
                {activeRouteOverview?.routeId ?? routeSummary?.routeId ?? '—'}
              </Text>
            </View>
            <View className="absolute bottom-3 left-3 rounded bg-[#1A2740] px-2 py-1">
              <Text className="text-[11px] text-[#DCE4F5]">
                ETA{' '}
                {activeRouteOverview?.totalEtaMinutes ?? routeSummary?.etaMinutes ?? '—'}{' '}
                min
              </Text>
            </View>
          </View>
        </View>

        <View className="rounded-xl border border-[#253A5A] bg-[#17263C] p-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#8FA7CB]">
              Routing controls
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Recompute active route"
              disabled={recomputingActiveRoute || !routeSummary?.routeId}
              onPress={handleRecomputeActiveRoute}
              className={`rounded-md bg-[#BFD0F7] px-3 py-2 ${
                recomputingActiveRoute || !routeSummary?.routeId
                  ? 'opacity-50'
                  : ''
              }`}
            >
              <Text className="text-[11px] font-semibold text-[#102950]">
                {recomputingActiveRoute ? 'Recomputing…' : 'Recompute route'}
              </Text>
            </Pressable>
          </View>

          {routingEdges.length === 0 ? (
            <Text className="mt-3 text-[12px] text-[#94A9C9]">
              No routing edges loaded.
            </Text>
          ) : (
            <View className="mt-3 gap-2">
              {routingEdges.map(edge => (
                <View
                  key={edge.edgeId}
                  className="rounded-lg border border-[#2E4569] bg-[#0F1B2C] p-3"
                >
                  <Text className="text-[12px] font-semibold text-[#E4ECFA]">
                    {edge.edgeId} · {formatEdgeTypeLabel(edge.edgeType)}
                  </Text>
                  <Text className="mt-1 text-[12px] text-[#A8B9D3]">
                    {(edge.sourceLabel ?? edge.sourceNodeId) + ' -> ' +
                      (edge.targetLabel ?? edge.targetNodeId)}
                  </Text>
                  <Text className="mt-1 text-[11px] text-[#8FA2C2]">
                    {formatStatusLabel(edge.status)} · {edge.travelTimeMinutes}m ·
                    risk {formatRisk(edge.riskScore)}
                  </Text>

                  <View className="mt-2 flex-row flex-wrap gap-2">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Set ${edge.edgeId} open`}
                      disabled={updatingEdgeId === edge.edgeId}
                      onPress={() =>
                        handleUpdateRouteEdgeStatus({ edge, status: 'open' })
                      }
                      className={`rounded-md bg-[#28445F] px-2.5 py-1.5 ${
                        updatingEdgeId === edge.edgeId ? 'opacity-50' : ''
                      }`}
                    >
                      <Text className="text-[11px] text-[#D9EEFF]">Open</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Set ${edge.edgeId} degraded`}
                      disabled={updatingEdgeId === edge.edgeId}
                      onPress={() =>
                        handleUpdateRouteEdgeStatus({
                          edge,
                          status: 'degraded',
                        })
                      }
                      className={`rounded-md bg-[#4A5A2B] px-2.5 py-1.5 ${
                        updatingEdgeId === edge.edgeId ? 'opacity-50' : ''
                      }`}
                    >
                      <Text className="text-[11px] text-[#E3F3D4]">Degraded</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Set ${edge.edgeId} washed out`}
                      disabled={updatingEdgeId === edge.edgeId}
                      onPress={() =>
                        handleUpdateRouteEdgeStatus({
                          edge,
                          status: 'washed_out',
                        })
                      }
                      className={`rounded-md bg-[#613232] px-2.5 py-1.5 ${
                        updatingEdgeId === edge.edgeId ? 'opacity-50' : ''
                      }`}
                    >
                      <Text className="text-[11px] text-[#FFD8D8]">Washed out</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {lastRoutingRecompute ? (
            <View className="mt-3 rounded-lg border border-[#2E4569] bg-[#0F1B2C] px-3 py-2">
              <Text className="text-[11px] text-[#D3E1F8]">
                Last run: {lastRoutingRecompute.recomputeDurationMs}ms ·
                {lastRoutingRecompute.withinTwoSeconds
                  ? ' within 2s target'
                  : ' above 2s target'}
              </Text>
              <Text className="mt-1 text-[11px] text-[#9FB3D2]">
                Affected routes: {lastRoutingRecompute.affectedRoutes.length}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="rounded-xl border border-[#2A2038] bg-[#1A1525] px-4 py-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#B8A0D4]">
            Route risk
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-[#E8EEF9]">
            Score {formatRisk(riskScore)} · {routeFailureLikely}
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Vehicles
          </Text>
          {dashboard.nodeHealth.map(node => (
            <View
              key={node.vehicleId}
              className="flex-row items-center justify-between rounded-xl border border-[#20314D] bg-[#202C41] px-3 py-3"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-[11px] text-[#8FA0BC]">{node.vehicleType}</Text>
                <Text className="text-[15px] font-medium text-[#EDF2FB]">
                  {node.vehicleId}
                </Text>
              </View>
              <Text className="text-[12px] text-[#E6A786]">
                {formatStatusLabel(node.status)}
              </Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Summary
          </Text>
          {buildDashboardOperations(activeSession.activeRole).map(item => (
            <View
              key={item.id}
              className="flex-row items-start gap-3 rounded-xl border border-[#20314D] bg-[#202C41] px-3 py-3"
            >
              <View className={`h-10 w-10 rounded-md ${item.accentClassName}`} />
              <View className="flex-1 gap-0.5">
                <Text className="text-[15px] font-medium text-[#EDF2FB]">
                  {item.title}
                </Text>
                <Text className="text-[12px] text-[#9EB0D0]">{item.subtitle}</Text>
              </View>
              <Text className="text-[12px] font-medium text-[#E6A786]">
                {item.trailingLabel}
              </Text>
            </View>
          ))}
        </View>

        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Active route
          </Text>
          <Text className="mt-2 text-[16px] font-semibold text-[#EEF3FC]">
            {activeRouteOverview?.routeId ?? routeSummary?.routeId ?? 'None'}
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-[#B8C4DA]">
            {activeRouteOverview
              ? `${activeRouteOverview.deliveryId} · ETA ${activeRouteOverview.totalEtaMinutes} min · risk ${formatRisk(activeRouteOverview.totalRiskScore)}`
              : routeSummary
                ? `${routeSummary.deliveryId} · ETA ${routeSummary.etaMinutes ?? '—'} min · risk ${formatRisk(routeSummary.totalRiskScore)}`
              : 'No route in current dataset.'}
          </Text>
          {activeRouteOverview?.legs.length ? (
            <View className="mt-3 gap-1">
              {activeRouteOverview.legs.slice(0, 3).map(leg => (
                <Text
                  key={`${activeRouteOverview.routeId}-${leg.edgeId}-${leg.fromNodeId}`}
                  className="text-[12px] text-[#9FB0C9]"
                >
                  {leg.fromNodeId}
                  {' -> '}
                  {leg.toNodeId} · {formatEdgeTypeLabel(leg.edgeType)} ·
                  {' '}
                  {leg.etaMinutes}m
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Constraints
          </Text>
          <View className="mt-3 gap-2">
            <Text className="text-[14px] text-[#E8EEF9]">
              Vehicle {nodeSummaries[0]?.vehicleType ?? '—'}
            </Text>
            <Text className="text-[14px] text-[#E8EEF9]">
              Handoff {routeSummary?.requiresHandoff ? 'required' : 'not required'}
            </Text>
            <Text className="text-[14px] text-[#E8EEF9]">
              Priority {routeSummary?.priorityTier ?? '—'}
            </Text>
          </View>
        </View>

        {routeSummary?.requiresHandoff &&
        roleAllowsHandoff(activeSession.activeRole) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Handoff"
            onPress={() => setCommandSubview('handoff')}
            className="min-h-[48px] items-center justify-center rounded-lg bg-[#BFD0F7] px-4"
          >
            <Text className="text-[14px] font-semibold text-[#102950]">Handoff</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderInventoryTab() {
    return (
      <View className="gap-3">
        {dashboard.supplies.map(supply => {
          const { localQty, peerQty } = splitLocalPeerQuantities(
            supply.quantity,
            supply.inventoryItemId,
          );
          const priority = cargoPriorityFromCategory(supply.category);

          return (
            <View
              key={supply.inventoryItemId}
              className="rounded-xl border border-[#213350] bg-[#212C40] p-4"
            >
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="text-[12px] font-semibold text-[#E6A786]">
                  {priority}
                </Text>
                <Text className="text-[11px] font-mono text-[#6B7A92]">
                  {supply.updatedAtMs}
                </Text>
              </View>
              <Text className="mt-2 text-[17px] font-semibold text-[#F1F5FD]">
                {supply.itemName}
              </Text>
              <Text className="mt-1 text-[12px] text-[#9EB0D0]">
                {supply.category} · {supply.storageNodeId}
              </Text>
              <View className="mt-4 flex-row gap-3">
                <View className="flex-1 rounded-[16px] border border-[#2F415E] bg-[#0D1627] px-3 py-3">
                  <Text className="text-[11px] font-bold uppercase text-[#8FA0BC]">
                    Local
                  </Text>
                  <Text className="mt-1 text-[20px] font-bold text-[#E8EEF9]">
                    {localQty} {supply.unit}
                  </Text>
                </View>
                <View className="flex-1 rounded-[16px] border border-[#2F415E] bg-[#0D1627] px-3 py-3">
                  <Text className="text-[11px] font-bold uppercase text-[#8FA0BC]">
                    Peer
                  </Text>
                  <Text className="mt-1 text-[20px] font-bold text-[#E8EEF9]">
                    {peerQty} {supply.unit}
                  </Text>
                </View>
              </View>
              <Text className="mt-3 text-[13px] text-[#8FA0BC]">
                {formatStatusLabel(supply.status)}
              </Text>
            </View>
          );
        })}

        <View className="gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Conflicts
          </Text>
          {dashboard.conflicts.length === 0 ? (
            <View className="rounded-xl border border-[#20314D] bg-[#182438] px-4 py-3">
              <Text className="text-[13px] text-[#8FA0BC]">None</Text>
            </View>
          ) : (
            dashboard.conflicts.map(conflict => {
              const expanded = expandedConflictId === conflict.conflictId;

              return (
                <View
                  key={conflict.conflictId}
                  className="rounded-xl border border-[#3A4B66] bg-[#18263B] p-4"
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle diff for conflict ${conflict.conflictId}`}
                    onPress={() =>
                      setExpandedConflictId(
                        expanded ? null : conflict.conflictId,
                      )
                    }
                  >
                    <Text className="text-[12px] text-[#E6A786]">
                      {conflict.entityType} · {conflict.entityId}
                    </Text>
                    <Text className="mt-1 text-[15px] font-medium text-[#F3F6FD]">
                      {conflict.fieldName}
                    </Text>
                    <Text className="mt-1 text-[11px] text-[#6B7A92]">
                      {expanded ? 'Hide' : 'Details'}
                    </Text>
                  </Pressable>
                  {expanded ? (
                    <View className="mt-3 gap-2 border-t border-[#2C3D56] pt-3">
                      <View className="flex-row gap-2">
                        <View className="flex-1 rounded-lg bg-[#0A1220] p-3">
                          <Text className="text-[10px] uppercase text-[#6B7A92]">
                            Local
                          </Text>
                          <Text className="mt-1 font-mono text-[11px] text-[#DCE4F5]">
                            {conflict.localValueText ?? 'No local snapshot'}
                          </Text>
                        </View>
                        <View className="flex-1 rounded-lg bg-[#0A1220] p-3">
                          <Text className="text-[10px] uppercase text-[#6B7A92]">
                            Peer
                          </Text>
                          <Text className="mt-1 font-mono text-[11px] text-[#DCE4F5]">
                            {conflict.remoteValueText ?? 'No peer snapshot'}
                          </Text>
                        </View>
                      </View>
                      <Text className="text-[13px] text-[#C4CEE2]">
                        Resolution:{' '}
                        <Text className="text-[#E8EEF9]">
                          {conflict.resolutionText ?? '—'}
                        </Text>
                      </Text>
                      {conflict.resolvedAtMs ? (
                        <Text className="text-[11px] text-[#7BC9A8]">
                          Resolved {conflict.resolvedAtMs}
                        </Text>
                      ) : (
                        <View className="mt-1 flex-row flex-wrap gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Resolve ${conflict.conflictId} with local value`}
                            disabled={resolvingConflictId === conflict.conflictId}
                            onPress={() =>
                              handleResolveConflict(conflict.conflictId, 'local')
                            }
                            className={`rounded-md bg-[#2A3D5D] px-3 py-2 ${
                              resolvingConflictId === conflict.conflictId
                                ? 'opacity-60'
                                : ''
                            }`}
                          >
                            <Text className="text-[11px] font-medium text-[#DFE8FA]">
                              Keep local
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Resolve ${conflict.conflictId} with peer value`}
                            disabled={resolvingConflictId === conflict.conflictId}
                            onPress={() =>
                              handleResolveConflict(conflict.conflictId, 'remote')
                            }
                            className={`rounded-md bg-[#244760] px-3 py-2 ${
                              resolvingConflictId === conflict.conflictId
                                ? 'opacity-60'
                                : ''
                            }`}
                          >
                            <Text className="text-[11px] font-medium text-[#D8F2FF]">
                              Apply peer
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Resolve ${conflict.conflictId} by merge`}
                            disabled={resolvingConflictId === conflict.conflictId}
                            onPress={() =>
                              handleResolveConflict(conflict.conflictId, 'merged')
                            }
                            className={`rounded-md bg-[#3A4D2A] px-3 py-2 ${
                              resolvingConflictId === conflict.conflictId
                                ? 'opacity-60'
                                : ''
                            }`}
                          >
                            <Text className="text-[11px] font-medium text-[#E0F2D8]">
                              Merge
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </View>
    );
  }

  function renderScannerTab() {
    return (
      <View className="gap-3">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
          Proof of delivery
        </Text>
        <View className="relative min-h-[280px] overflow-hidden rounded-xl border border-[#3A4D6C] bg-[#05080e]">
          <View className="absolute inset-0 bg-[#0a1628] opacity-90" />
          <View className="absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2 border-[#6B7A92]" />
          <View className="absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2 border-[#6B7A92]" />
          <View className="absolute bottom-3 left-3 h-6 w-6 border-b-2 border-l-2 border-[#6B7A92]" />
          <View className="absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2 border-[#6B7A92]" />
          <View className="flex-1 items-center justify-center px-6 py-12">
            <Text className="text-center text-[13px] text-[#6B7A92]">
              Camera not wired · placeholder
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Simulate scan"
          onPress={() =>
            setScanDemoState(previous =>
              previous === 'idle'
                ? 'success'
                : previous === 'success'
                  ? 'tamper'
                  : 'idle',
            )
          }
          className="min-h-[48px] items-center justify-center rounded-lg bg-[#BFD0F7] px-4"
        >
          <Text className="text-[14px] font-semibold text-[#102950]">
            Simulate scan
          </Text>
        </Pressable>

        {scanDemoState === 'idle' ? (
          <Text className="text-[12px] text-[#6B7A92]">Idle</Text>
        ) : null}
        {scanDemoState === 'success' ? (
          <View className="rounded-xl border border-[#37635B] bg-[#17332E] p-3">
            <Text className="text-[13px] font-medium text-[#9FD4C4]">Verified</Text>
            <Text className="mt-1 text-[13px] text-[#C4D4E8]">
              Signature OK · receipt recorded (demo)
            </Text>
          </View>
        ) : null}
        {scanDemoState === 'tamper' ? (
          <View className="rounded-xl border border-[#6A403D] bg-[#3A2221] p-3">
            <Text className="text-[13px] font-medium text-[#F0B39A]">Rejected</Text>
            <Text className="mt-1 text-[13px] text-[#E7ECF8]">
              Hash mismatch · audit event (demo)
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderMeshTab() {
    const meshRoleLabel = meshRoleCycle
      ? meshRoleCycle.role.toUpperCase()
      : dashboard.sync.peerCount > 0
        ? 'RELAY-CAPABLE'
        : 'CLIENT';

    return (
      <View className="gap-3">
        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            This node
          </Text>
          <Text className="mt-2 text-[18px] font-semibold text-[#EEF3FC]">
            {meshRoleLabel}
          </Text>
          {meshRoleCycle ? (
            <View className="mt-3 gap-1">
              <MeshRow
                label="Relay score"
                value={meshRoleCycle.relayScore.toFixed(1)}
              />
              <MeshRow
                label="Battery"
                value={`${meshRoleCycle.batteryPercent}%`}
              />
              <MeshRow
                label="Signal"
                value={`${meshRoleCycle.signalStrength}%`}
              />
              <MeshRow
                label="Nearby peers"
                value={String(meshRoleCycle.nearbyPeerCount)}
              />
            </View>
          ) : null}
        </View>

        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Sync
          </Text>
          <View className="mt-3 gap-2">
            <MeshRow
              label="Link"
              value={formatConnectivityLabel(dashboard.connectivityState)}
            />
            <MeshRow label="Peers" value={String(dashboard.sync.peerCount)} />
            <MeshRow
              label="Queued"
              value={String(dashboard.sync.queuedEnvelopeCount)}
            />
            <MeshRow
              label="In flight"
              value={String(dashboard.sync.inFlightEnvelopeCount)}
            />
          </View>
        </View>

        <View className="flex-row items-center justify-between rounded-xl border border-[#2F415E] bg-[#182438] px-4 py-3">
          <Text className="flex-1 text-[14px] text-[#D0D9EC]">
            Low-power throttle
          </Text>
          <Switch
            accessibilityLabel="Mesh throttle on low battery"
            value={meshThrottleEnabled}
            onValueChange={setMeshThrottleEnabled}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Evaluate mesh role"
          disabled={evaluatingMeshRole || !activeSession}
          onPress={handleEvaluateMeshRole}
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#445B2B] px-4 ${
            evaluatingMeshRole || !activeSession ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[13px] font-medium text-[#E6F2D8]">
            {evaluatingMeshRole ? 'Evaluating role…' : 'Evaluate role heuristic'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run delta sync cycle"
          disabled={syncingMesh || !activeSession}
          onPress={handleRunMeshSync}
          className={`min-h-[48px] items-center justify-center rounded-lg bg-[#BFD0F7] px-4 ${
            syncingMesh || !activeSession ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[14px] font-semibold text-[#102950]">
            {syncingMesh ? 'Syncing…' : 'Run delta sync'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run encrypted store-forward all online"
          disabled={runningStoreForward || !activeSession}
          onPress={() =>
            handleRunStoreForward({ relayOnline: true, recipientOnline: true })
          }
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#37635B] px-4 ${
            runningStoreForward || !activeSession ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[13px] font-medium text-[#DDF4ED]">
            {runningStoreForward ? 'Running…' : 'Run encrypted A->B->C'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run encrypted store-forward with relay offline"
          disabled={runningStoreForward || !activeSession}
          onPress={() =>
            handleRunStoreForward({ relayOnline: false, recipientOnline: true })
          }
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#5F4A1F] px-4 ${
            runningStoreForward || !activeSession ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[13px] font-medium text-[#FFE6B8]">
            Queue while relay offline
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume relay forwarding"
          disabled={resumingRelay || !activeSession}
          onPress={handleResumeRelayForwarding}
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#3C365A] px-4 ${
            resumingRelay || !activeSession ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[13px] font-medium text-[#E0DBFF]">
            {resumingRelay ? 'Resuming…' : 'Resume relay forwarding'}
          </Text>
        </Pressable>

        {lastSyncCycle ? (
          <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              Last cycle
            </Text>
            <View className="mt-2 gap-1">
              <MeshRow label="Peer" value={lastSyncCycle.peerDeviceId} />
              <MeshRow label="Transport" value={lastSyncCycle.transport} />
              <MeshRow
                label="Transport sent"
                value={lastSyncCycle.transportSent ? 'yes' : 'no'}
              />
              <MeshRow
                label="Exported"
                value={String(lastSyncCycle.exportedEventCount)}
              />
              <MeshRow
                label="Imported"
                value={String(lastSyncCycle.importedEventCount)}
              />
              <MeshRow
                label="Conflicts"
                value={String(lastSyncCycle.conflictsDetected)}
              />
              <MeshRow
                label="Envelope"
                value={`${lastSyncCycle.envelopeSizeBytes} B`}
              />
            </View>
          </View>
        ) : null}

        {meshStoreForwardCycle ? (
          <View className="rounded-xl border border-[#3A4B66] bg-[#18263B] p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#9AB1D6]">
              Last store-forward cycle
            </Text>
            <View className="mt-2 gap-1">
              <MeshRow label="Packet" value={meshStoreForwardCycle.packetId} />
              <MeshRow
                label="Sender"
                value={meshStoreForwardCycle.senderDeviceId}
              />
              <MeshRow
                label="Relay"
                value={meshStoreForwardCycle.relayDeviceId}
              />
              <MeshRow
                label="Recipient"
                value={meshStoreForwardCycle.recipientDeviceId}
              />
              <MeshRow
                label="Sender dispatches"
                value={String(meshStoreForwardCycle.senderDispatches)}
              />
              <MeshRow
                label="Relay dispatches"
                value={String(meshStoreForwardCycle.relayDispatches)}
              />
              <MeshRow
                label="Delivered"
                value={meshStoreForwardCycle.delivered ? 'yes' : 'no'}
              />
              <MeshRow
                label="Relay stored"
                value={meshStoreForwardCycle.relayStored ? 'yes' : 'no'}
              />
            </View>
          </View>
        ) : null}

        {meshRelaySnapshot ? (
          <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              Relay queue snapshot
            </Text>
            <View className="mt-2 gap-1">
              <MeshRow
                label="Sender pending"
                value={String(meshRelaySnapshot.queue.senderPending)}
              />
              <MeshRow
                label="Relay pending"
                value={String(meshRelaySnapshot.queue.relayPending)}
              />
              <MeshRow
                label="Recipient pending"
                value={String(meshRelaySnapshot.queue.recipientPending)}
              />
            </View>
          </View>
        ) : null}

        {meshRelaySnapshot ? (
          <View className="gap-2 rounded-xl border border-[#20314D] bg-[#182438] p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              Relay logs
            </Text>
            <Text className="text-[12px] text-[#8FA0BC]">Sender</Text>
            {meshRelaySnapshot.logs.sender.slice(0, 4).map(log => (
              <Text
                key={`sender-${log.packetId}-${log.occurredAtMs}-${log.action}`}
                className="text-[11px] text-[#CBD6EB]"
              >
                {`${formatZuluTimestamp(log.occurredAtMs)} · ${log.action} · ${log.status}${log.detail ? ` · ${log.detail}` : ''}`}
              </Text>
            ))}

            <Text className="mt-2 text-[12px] text-[#8FA0BC]">Relay</Text>
            {meshRelaySnapshot.logs.relay.slice(0, 4).map(log => (
              <Text
                key={`relay-${log.packetId}-${log.occurredAtMs}-${log.action}`}
                className="text-[11px] text-[#CBD6EB]"
              >
                {`${formatZuluTimestamp(log.occurredAtMs)} · ${log.action} · ${log.status}${log.detail ? ` · ${log.detail}` : ''}`}
              </Text>
            ))}

            <Text className="mt-2 text-[12px] text-[#8FA0BC]">Recipient</Text>
            {meshRelaySnapshot.logs.recipient.slice(0, 4).map(log => (
              <Text
                key={`recipient-${log.packetId}-${log.occurredAtMs}-${log.action}`}
                className="text-[11px] text-[#CBD6EB]"
              >
                {`${formatZuluTimestamp(log.occurredAtMs)} · ${log.action} · ${log.status}${log.detail ? ` · ${log.detail}` : ''}`}
              </Text>
            ))}
          </View>
        ) : null}

        <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
          Peers
        </Text>
        {dashboard.nodeHealth.map(node => (
          <View
            key={node.vehicleId}
            className="rounded-xl border border-[#213350] bg-[#212C40] p-4"
          >
            <Text className="text-[14px] font-medium text-[#F0F4FC]">
              {node.vehicleId}
            </Text>
            <Text className="mt-1 text-[13px] text-[#9EB0D0]">
              {formatStatusLabel(node.status)} · {node.batteryPercent ?? '—'}% ·{' '}
              {node.currentNodeId ?? '—'}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  function renderIdentityTab() {
    if (!activeSession) {
      return null;
    }

    return (
      <View className="gap-3">
        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Operator
          </Text>
          <Text className="mt-2 text-[17px] font-semibold text-[#F0F4FC]">
            {activeSession.displayName}
          </Text>
          <Text className="mt-1 text-[13px] text-[#8FA0BC]">
            {loginData.userId} · {loginData.deviceId}
          </Text>
          <Text className="mt-2 text-[14px] text-[#D7DEEF]">
            {formatRoleLabel(activeSession.activeRole)}
          </Text>
        </View>

        <View className="rounded-xl border border-[#27344A] bg-[#222D42] p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
              OTP
            </Text>
            <Text className="text-[12px] text-[#C9A27A]">
              {fieldOtpChallenge ? `${fieldOtpRemainingSeconds}s` : '—'}
            </Text>
          </View>
          <Text className="mt-3 text-[26px] font-semibold tracking-widest text-[#E8EEF9]">
            {fieldOtpChallenge ? fieldOtpChallenge.demoCode : '······'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Issue OTP"
            disabled={requestingFieldOtp}
            onPress={handleRequestFieldOtp}
            className={`mt-4 min-h-[44px] items-center justify-center rounded-lg bg-[#2A3D5D] px-4 ${
              requestingFieldOtp ? 'opacity-60' : ''
            }`}
          >
            <Text className="text-[13px] font-medium text-[#DFE8FA]">
              {requestingFieldOtp ? '…' : 'New code'}
            </Text>
          </Pressable>
        </View>

        <View className="rounded-xl border border-[#20304A] bg-[#0D1627] p-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Audit log
          </Text>
          <ScrollView className="mt-2 max-h-[160px]" nestedScrollEnabled>
            {auditTerminalLines.length === 0 ? (
              <Text className="font-mono text-[11px] text-[#5C6B86]">—</Text>
            ) : (
              auditTerminalLines.map((line, index) => (
                <Text
                  key={`${line}-${index}`}
                  className="font-mono text-[10px] leading-4 text-[#9EB4D8]"
                >
                  {line}
                </Text>
              ))
            )}
          </ScrollView>
        </View>

        {renderSecurityPanel()}
      </View>
    );
  }

  function renderHandoffView() {
    return (
      <View className="gap-3">
        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Handoff
          </Text>
          <Text className="mt-2 text-[16px] font-semibold text-[#EFF3FC]">
            {routeSummary?.requiresHandoff ? 'Required' : 'Not required'}
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-[#BEC9DE]">
            {routeSummary?.requiresHandoff
              ? `Waypoint ${triageAlerts[0]?.safeWaypointNodeId ?? '—'} · ${routeSummary.deliveryId}`
              : '—'}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => setCommandSubview('main')}
          className="min-h-[44px] items-center justify-center rounded-lg bg-[#BFD0F7] px-4"
        >
          <Text className="text-[14px] font-semibold text-[#102950]">Back</Text>
        </Pressable>
      </View>
    );
  }

  function renderBrandHeader() {
    return (
      <View className="flex-row items-center justify-between gap-4 px-1">
        <Text className="text-[15px] font-semibold text-[#D8E2F5]">
          Digital Delta
        </Text>
        <View className="rounded-md border border-[#20314C] bg-[#111C2D] px-2 py-1">
          <Text className="text-[11px] font-medium text-[#C8D5EF]">
            {formatConnectivityLabel(dashboard.connectivityState)}
          </Text>
        </View>
      </View>
    );
  }

  function renderNoticeCard() {
    return (
      <View
        className={`rounded-xl border px-3 py-3 ${buildNoticeClassName(
          authNotice?.tone ?? 'default',
        )}`}
      >
        <Text className="text-[14px] font-medium text-white">
          {authNotice?.title}
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-[#E7ECF8]">
          {authNotice?.message}
        </Text>
      </View>
    );
  }

  function renderLiveNotifications() {
    return (
      <View className="rounded-xl border border-[#20304A] bg-[#0D1627] p-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Real-time notifications
          </Text>
          <Text className="text-[11px] text-[#6B7A92]">
            {liveNotifications.length}
          </Text>
        </View>

        <ScrollView className="mt-2 max-h-[180px]" nestedScrollEnabled>
          {liveNotifications.length === 0 ? (
            <Text className="text-[12px] text-[#6B7A92]">
              Waiting for auth and sync events.
            </Text>
          ) : (
            liveNotifications.map(notification => (
              <View
                key={notification.id}
                className={`mb-2 rounded-lg border px-3 py-2 ${buildNoticeClassName(notification.tone)}`}
              >
                <Text className="text-[13px] font-medium text-white">
                  {notification.title}
                </Text>
                <Text className="mt-1 text-[12px] text-[#E7ECF8]">
                  {notification.message}
                </Text>
                <Text className="mt-1 text-[10px] text-[#C5CFDF]">
                  {formatZuluTimestamp(notification.occurredAtMs)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  function renderSecurityPanel() {
    return (
      <View className="gap-2 rounded-xl border border-[#1D2D46] bg-[#121D31] p-4">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
          Device
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Verify audit"
          disabled={verifyingAudit}
          onPress={handleVerifyAuditTrail}
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#BFD0F7] px-4 ${
            verifyingAudit ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[14px] font-semibold text-[#102950]">
            {verifyingAudit ? '…' : 'Verify audit chain'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rotate key"
          disabled={rotatingKey}
          onPress={handleRotateKey}
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#2A3D5D] px-4 ${
            rotatingKey ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[14px] font-medium text-[#DFE8FA]">
            {rotatingKey ? '…' : 'Rotate device key'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Inject audit tamper demo"
          disabled={injectingAuditCorruption}
          onPress={handleInjectAuditCorruption}
          className={`min-h-[44px] items-center justify-center rounded-lg bg-[#4E2C2B] px-4 ${
            injectingAuditCorruption ? 'opacity-60' : ''
          }`}
        >
          <Text className="text-[13px] font-medium text-[#FFD5C6]">
            {injectingAuditCorruption ? '…' : 'Inject tamper (test)'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={handleSignOut}
          className="min-h-[44px] items-center justify-center rounded-lg border border-[#30445F] px-4"
        >
          <Text className="text-[14px] font-medium text-[#D4DDF0]">Sign out</Text>
        </Pressable>

        <View className="gap-1.5 rounded-lg border border-[#20304A] bg-[#0D1627] p-3">
          <Text className="text-[13px] text-[#E6ECF8]">
            Role: {formatRoleLabel(activeSession?.activeRole ?? selectedRole)}
          </Text>
          <Text className="text-[12px] text-[#8FA0BC]">
            Tabs: {allowedScreens.map(formatTabLabel).join(', ')}
          </Text>
          {auditStatus ? (
            <Text className="text-[12px] text-[#B3C1DA]">
              Last check: {auditStatus.valid ? 'OK' : 'FAIL'} ·{' '}
              {auditStatus.scannedEntries} entries
              {auditStatus.brokenLogId ? ` · ${auditStatus.brokenLogId}` : ''}
            </Text>
          ) : null}
          {keySnapshot.keyFingerprint ? (
            <Text className="text-[11px] text-[#6B7A92]" selectable>
              {keySnapshot.keyFingerprint}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderOtpSlots(code: string) {
    return splitOtpDigits(code).map((digit, index) => (
      <View
        key={`otp-slot-${index}`}
        className="h-14 flex-1 items-center justify-center rounded-md bg-[#071021]"
      >
        <Text className="text-[22px] font-semibold tracking-wider text-[#E8EEF9]">
          {digit || ' '}
        </Text>
      </View>
    ));
  }

  function buildDashboardOperations(role: AuthRole) {
    const delivery = {
      id: 'delivery',
      title: routeSummary
        ? routeSummary.deliveryId
        : 'No delivery',
      subtitle: routeSummary
        ? `${routeSummary.priorityTier} · ${routeSummary.status}`
        : '—',
      trailingLabel: routeSummary?.etaMinutes
        ? `${routeSummary.etaMinutes}m`
        : '—',
      accentClassName: 'bg-[#B92F36]',
    };
    const supply = {
      id: 'supply',
      title: supplySummaries[0]?.itemName ?? 'Inventory',
      subtitle: supplySummaries[0]
        ? `${supplySummaries[0].quantity} ${supplySummaries[0].unit}`
        : '—',
      trailingLabel: supplySummaries[0]?.storageNodeId ?? '—',
      accentClassName: 'bg-[#294B81]',
    };
    const network = {
      id: 'network',
      title: `Queue ${dashboard.sync.queuedEnvelopeCount}`,
      subtitle: `${dashboard.sync.peerCount} peers`,
      trailingLabel:
        dashboard.connectivityState === 'offline' ? 'Offline' : 'Live',
      accentClassName: 'bg-[#3F4C63]',
    };

    switch (role) {
      case 'DRONE_OPERATOR':
        return [delivery, network];
      case 'CAMP_COMMANDER':
        return [delivery, supply];
      case 'SYNC_ADMIN':
        return [network, delivery];
      case 'FIELD_VOLUNTEER':
      case 'SUPPLY_MANAGER':
      default:
        return [delivery, supply, network];
    }
  }
}

function MeshRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-0.5">
      <Text className="text-[14px] text-[#8FA0BC]">{label}</Text>
      <Text className="text-[14px] text-[#EEF2FA]">{value}</Text>
    </View>
  );
}

function splitOtpDigits(code: string): string[] {
  return Array.from({ length: 6 }, (_, index) => code[index] ?? '');
}

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatConnectivityLabel(
  state: DashboardScreenData['connectivityState'],
): string {
  switch (state) {
    case 'conflict-detected':
      return 'Conflict Detected';
    case 'verified':
      return 'Verified';
    case 'syncing':
      return 'Syncing';
    case 'offline':
    default:
      return 'Offline';
  }
}

function formatTabLabel(tab: BottomTabScreen): string {
  switch (tab) {
    case 'Command':
      return 'Command';
    case 'Inventory':
      return 'Inventory';
    case 'Scanner':
      return 'Scanner';
    case 'Mesh':
      return 'Mesh';
    case 'Identity':
    default:
      return 'Identity';
  }
}

function splitLocalPeerQuantities(
  total: number,
  inventoryItemId: string,
): { localQty: number; peerQty: number } {
  if (total <= 0) {
    return { localQty: 0, peerQty: 0 };
  }

  const seed = inventoryItemId
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const ratio = 0.35 + (seed % 40) / 100;
  const localQty = Math.max(0, Math.round(total * ratio));
  const peerQty = Math.max(0, total - localQty);

  return { localQty, peerQty };
}

function cargoPriorityFromCategory(category: string): string {
  const upper = category.toUpperCase();
  if (upper.includes('P0') || upper.includes('CRITICAL')) {
    return 'P0';
  }
  if (upper.includes('P1')) {
    return 'P1';
  }
  if (upper.includes('P2')) {
    return 'P2';
  }
  if (upper.includes('P3')) {
    return 'P3';
  }

  return 'P2';
}

function formatZuluTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return 'Awaiting sync';
  }

  return new Date(timestamp).toISOString().slice(11, 19).concat(' ZULU');
}

function formatRisk(risk?: number): string {
  if (typeof risk !== 'number') {
    return '--';
  }

  return risk.toFixed(2);
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatEdgeTypeLabel(edgeType: string): string {
  if (edgeType === 'road') {
    return 'Road';
  }

  if (edgeType === 'waterway') {
    return 'Waterway';
  }

  if (edgeType === 'airway') {
    return 'Airway';
  }

  return edgeType;
}

function estimateSignalStrength(dashboardData: DashboardScreenData): number {
  if (dashboardData.connectivityState === 'offline') {
    return 68;
  }

  return Math.min(96, 56 + dashboardData.sync.peerCount * 12);
}

function buildThreatHeadline(
  routeSummary: DashboardScreenData['routes'][number] | undefined,
  triageAlert: DashboardScreenData['triageAlerts'][number] | undefined,
): string {
  if (triageAlert && routeSummary) {
    return `${triageAlert.highestRemainingPriority} routing warning on ${routeSummary.deliveryId}`;
  }

  if (routeSummary) {
    return `Route oversight active for ${routeSummary.deliveryId}`;
  }

  return 'No active route threat detected';
}

function buildRoleChipClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  const baseClassName = 'rounded-full border px-3 py-2';

  if (!input.allowed) {
    return `${baseClassName} border-[#304159] bg-[#172235] opacity-40`;
  }

  if (input.selected) {
    return `${baseClassName} border-[#91AEEA] bg-[#243B69]`;
  }

  return `${baseClassName} border-[#344861] bg-[#162235]`;
}

function buildRoleChipTextClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  if (!input.allowed) {
    return 'text-[11px] font-bold uppercase tracking-[1.3px] text-[#8090AD]';
  }

  if (input.selected) {
    return 'text-[11px] font-bold uppercase tracking-[1.3px] text-[#E5EEFF]';
  }

  return 'text-[11px] font-bold uppercase tracking-[1.3px] text-[#B7C5E3]';
}

function buildNavItemClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  const baseClassName =
    'flex-1 items-center justify-center rounded-lg px-1 py-2 min-h-[44px]';

  if (!input.allowed) {
    return `${baseClassName} opacity-40`;
  }

  if (input.selected) {
    return `${baseClassName} bg-[#203A69]`;
  }

  return `${baseClassName} bg-transparent`;
}

function buildNavItemTextClassName(input: {
  allowed: boolean;
  selected: boolean;
}): string {
  if (!input.allowed) {
    return 'text-[10px] font-medium text-[#7E91B0]';
  }

  if (input.selected) {
    return 'text-[10px] font-semibold text-[#DCE8FF]';
  }

  return 'text-[10px] font-medium text-[#B7C4DE]';
}

function buildNoticeClassName(tone: NonNullable<AuthNotice['tone']>): string {
  if (tone === 'success') {
    return 'border-[#37635B] bg-[#17332E]';
  }

  if (tone === 'danger') {
    return 'border-[#6A403D] bg-[#3A2221]';
  }

  if (tone === 'warning') {
    return 'border-[#7A5D34] bg-[#3B2C18]';
  }

  return 'border-[#2F4668] bg-[#17253C]';
}
