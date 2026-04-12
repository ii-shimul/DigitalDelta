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
  DashboardScreenData,
  LoginScreenData,
} from '../../../api';
import { AUTH_ROLES, AuthApi, getAvailableAuthRoles } from '../../../api';
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

const authApi = new AuthApi();

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
  const isWideLayout = width >= 768;
  const routeSummary = dashboardData.routes[0];
  const supplySummaries = dashboardData.supplies.slice(0, 3);
  const nodeSummaries = dashboardData.nodeHealth.slice(0, 3);
  const triageAlerts = dashboardData.triageAlerts.slice(0, 3);
  const allowedScreens = activeSession
    ? ROLE_ALLOWED_SCREENS[activeSession.activeRole]
    : [];
  const primaryButtonLabel = otpChallenge
    ? otpCode.length === 6
      ? 'Verify'
      : 'Enter 6-digit code'
    : 'Get code';
  const syncTimestampLabel = formatZuluTimestamp(
    dashboardData.sync.lastSyncedAtMs ?? loginData.lastLoginAtMs,
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

  const remainingSeconds = otpChallenge
    ? Math.max(0, Math.ceil((otpChallenge.expiresAtMs - nowMs) / 1000))
    : 0;
  const fieldOtpRemainingSeconds = fieldOtpChallenge
    ? Math.max(
        0,
        Math.ceil((fieldOtpChallenge.expiresAtMs - fieldOtpNowMs) / 1000),
      )
    : 0;

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
    } catch (error) {
      setAuthNotice({
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
    } catch (error) {
      setAuthNotice({
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
    } catch (error) {
      setAuthNotice({
        tone: 'danger',
        title: 'Audit corruption failed',
        message:
          error instanceof Error
            ? error.message
            : 'The demo corruption step could not be applied.',
      });
    } finally {
      setInjectingAuditCorruption(false);
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
              {formatConnectivityLabel(dashboardData.connectivityState)}
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
          Modes: road · water · air · cached map tiles
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

        {dashboardData.triageAlerts.slice(1).map(alert => (
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
                {routeSummary?.routeId ?? '—'}
              </Text>
            </View>
            <View className="absolute bottom-3 left-3 rounded bg-[#1A2740] px-2 py-1">
              <Text className="text-[11px] text-[#DCE4F5]">
                ETA {routeSummary?.etaMinutes ?? '—'} min
              </Text>
            </View>
          </View>
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
          {dashboardData.nodeHealth.map(node => (
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
            {routeSummary?.routeId ?? 'None'}
          </Text>
          <Text className="mt-2 text-[14px] leading-5 text-[#B8C4DA]">
            {routeSummary
              ? `${routeSummary.deliveryId} · ETA ${routeSummary.etaMinutes ?? '—'} min · risk ${formatRisk(routeSummary.totalRiskScore)}`
              : 'No route in current dataset.'}
          </Text>
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
        {dashboardData.supplies.map(supply => {
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
          {dashboardData.conflicts.length === 0 ? (
            <View className="rounded-xl border border-[#20314D] bg-[#182438] px-4 py-3">
              <Text className="text-[13px] text-[#8FA0BC]">None</Text>
            </View>
          ) : (
            dashboardData.conflicts.map(conflict => {
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
                            {conflict.fieldName} pending
                          </Text>
                        </View>
                        <View className="flex-1 rounded-lg bg-[#0A1220] p-3">
                          <Text className="text-[10px] uppercase text-[#6B7A92]">
                            Peer
                          </Text>
                          <Text className="mt-1 font-mono text-[11px] text-[#DCE4F5]">
                            {conflict.fieldName} pending
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
                      ) : null}
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
    const meshRole =
      dashboardData.sync.peerCount > 0 ? 'Relay-capable' : 'Client';

    return (
      <View className="gap-3">
        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            This node
          </Text>
          <Text className="mt-2 text-[18px] font-semibold text-[#EEF3FC]">
            {meshRole}
          </Text>
        </View>

        <View className="rounded-xl border border-[#213350] bg-[#212C40] p-4">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
            Sync
          </Text>
          <View className="mt-3 gap-2">
            <MeshRow
              label="Link"
              value={formatConnectivityLabel(dashboardData.connectivityState)}
            />
            <MeshRow label="Peers" value={String(dashboardData.sync.peerCount)} />
            <MeshRow
              label="Queued"
              value={String(dashboardData.sync.queuedEnvelopeCount)}
            />
            <MeshRow
              label="In flight"
              value={String(dashboardData.sync.inFlightEnvelopeCount)}
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

        <Text className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8BAD]">
          Peers
        </Text>
        {dashboardData.nodeHealth.map(node => (
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
            {formatConnectivityLabel(dashboardData.connectivityState)}
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
      title: `Queue ${dashboardData.sync.queuedEnvelopeCount}`,
      subtitle: `${dashboardData.sync.peerCount} peers`,
      trailingLabel:
        dashboardData.connectivityState === 'offline' ? 'Offline' : 'Live',
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
