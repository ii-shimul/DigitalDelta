import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { DashboardScreenData, LoginScreenData } from '../../api';
import {
  AUTH_ROLES,
  AuthPlaceholderAdapter,
  type AuthRole,
  type AuthenticatedSession,
  type OtpSession,
} from '../../api';
import type { AppScreen } from './contracts';

type AuthAccessFlowProps = {
  loginData: LoginScreenData;
  dashboardData: DashboardScreenData;
};

type AuthStatusKind =
  | 'otp-invalid'
  | 'otp-expired'
  | 'access-denied'
  | 'key-provisioning'
  | 'verified';

type AuthStatus = {
  kind: AuthStatusKind;
  title: string;
  message: string;
};

const authAdapter = new AuthPlaceholderAdapter();

const ROLE_ALLOWED_SCREENS: Record<AuthRole, AppScreen[]> = {
  FIELD_VOLUNTEER: ['Dashboard', 'RouteDetails', 'DeliveryDetails', 'SyncStatus'],
  SUPPLY_MANAGER: [
    'Dashboard',
    'RouteDetails',
    'DeliveryDetails',
    'SyncStatus',
    'HandoffFlow',
  ],
  DRONE_OPERATOR: ['Dashboard', 'RouteDetails', 'HandoffFlow', 'SyncStatus'],
  CAMP_COMMANDER: ['Dashboard', 'DeliveryDetails'],
  SYNC_ADMIN: ['Dashboard', 'SyncStatus'],
};

const OPERATIONS_SCREENS: AppScreen[] = [
  'Dashboard',
  'RouteDetails',
  'DeliveryDetails',
  'SyncStatus',
  'HandoffFlow',
];

function toAuthRole(value: string): AuthRole | null {
  const normalized = value.trim().toUpperCase();
  return AUTH_ROLES.find(role => role === normalized) ?? null;
}

function getInitialRole(loginData: LoginScreenData): AuthRole {
  const roleFromAccount = loginData.roles
    .map(role => toAuthRole(role))
    .find((role): role is AuthRole => Boolean(role));

  return roleFromAccount ?? 'FIELD_VOLUNTEER';
}

export function AuthAccessFlow(props: AuthAccessFlowProps) {
  const [selectedRole, setSelectedRole] = useState<AuthRole>(
    getInitialRole(props.loginData),
  );
  const [otpSession, setOtpSession] = useState<OtpSession | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [activeSession, setActiveSession] = useState<AuthenticatedSession | null>(
    null,
  );
  const [selectedOperationScreen, setSelectedOperationScreen] =
    useState<AppScreen>('Dashboard');
  const [isKeyProvisionedOverride, setIsKeyProvisionedOverride] = useState(
    props.loginData.keyProvisioned,
  );

  const effectiveLoginData = useMemo(
    () => ({
      ...props.loginData,
      keyProvisioned: isKeyProvisionedOverride,
    }),
    [isKeyProvisionedOverride, props.loginData],
  );

  const roleAllowedScreens = activeSession
    ? ROLE_ALLOWED_SCREENS[activeSession.activeRole]
    : [];

  const requestOtp = () => {
    const session = authAdapter.requestOtp(effectiveLoginData.userId, selectedRole);
    setOtpSession(session);
    setOtpCode('');
    setAuthStatus(null);
  };

  const verifyOtp = () => {
    if (!otpSession) {
      return;
    }

    const result = authAdapter.verifyOtp({
      loginData: effectiveLoginData,
      otpCode,
      otpSession,
    });

    if (result.ok) {
      setActiveSession(result.authenticated);
      setAuthStatus({
        kind: 'verified',
        title: 'Verification successful',
        message: 'OTP and role checks passed. You can continue to the dashboard.',
      });
      return;
    }

    if (result.errorCode === 'OTP_INVALID') {
      setAuthStatus({
        kind: 'otp-invalid',
        title: 'Invalid OTP',
        message: result.message,
      });
      return;
    }

    if (result.errorCode === 'OTP_EXPIRED') {
      setAuthStatus({
        kind: 'otp-expired',
        title: 'OTP expired',
        message: result.message,
      });
      return;
    }

    if (result.errorCode === 'ACCESS_DENIED') {
      setAuthStatus({
        kind: 'access-denied',
        title: 'Access denied',
        message: result.message,
      });
      return;
    }

    setAuthStatus({
      kind: 'key-provisioning',
      title: 'Key provisioning required',
      message: result.message,
    });
  };

  const continueToHome = () => {
    if (!activeSession) {
      return;
    }

    const allowed = ROLE_ALLOWED_SCREENS[activeSession.activeRole];
    setSelectedOperationScreen(allowed[0] ?? 'Dashboard');
  };

  const resetFlow = () => {
    setOtpSession(null);
    setOtpCode('');
    setAuthStatus(null);
    setActiveSession(null);
    setSelectedRole(getInitialRole(props.loginData));
    setIsKeyProvisionedOverride(props.loginData.keyProvisioned);
  };

  const showHome = Boolean(activeSession && authStatus?.kind === 'verified');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Authentication</Text>
        <Text style={styles.heroTitle}>Secure Authentication and Role Access</Text>
        <Text style={styles.heroBody}>
          This flow validates OTP status, role-based access, and key provisioning
          state before granting navigation access.
        </Text>
        <View style={styles.stateChip}>
          <Text style={styles.stateChipText}>
            {props.dashboardData.connectivityState}
          </Text>
        </View>
      </View>

      {!otpSession ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Login</Text>
          <Text style={styles.label}>User</Text>
          <Text style={styles.valueText}>{effectiveLoginData.displayName}</Text>
          <Text style={styles.metaText}>User ID: {effectiveLoginData.userId}</Text>

          <Text style={[styles.label, styles.blockTop]}>Choose role</Text>
          <View style={styles.roleGrid}>
            {AUTH_ROLES.map(role => {
              const isSelected = selectedRole === role;
              return (
                <Pressable
                  key={role}
                  accessibilityLabel={`Select role ${role}`}
                  onPress={() => setSelectedRole(role)}
                  style={[
                    styles.roleButton,
                    isSelected ? styles.roleButtonActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleButtonText,
                      isSelected ? styles.roleButtonTextActive : null,
                    ]}
                  >
                    {role}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityLabel="Request OTP"
            onPress={requestOtp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Request OTP</Text>
          </Pressable>
        </View>
      ) : null}

      {otpSession ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>OTP Verification</Text>
          <Text style={styles.metaText}>Session: {otpSession.otpSessionId}</Text>
          <Text style={styles.metaText}>
            Expires at: {new Date(otpSession.expiresAtMs).toLocaleTimeString()}
          </Text>

          <Text style={[styles.label, styles.blockTop]}>Enter 6-digit OTP</Text>
          <TextInput
            accessibilityLabel="OTP input"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setOtpCode}
            placeholder="Enter OTP"
            placeholderTextColor="#7b7f88"
            style={styles.otpInput}
            value={otpCode}
          />

          <View style={styles.rowActions}>
            <Pressable
              accessibilityLabel="Verify OTP"
              onPress={verifyOtp}
              style={[styles.primaryButton, styles.inlineButton]}
            >
              <Text style={styles.primaryButtonText}>Verify OTP</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Request new OTP"
              onPress={requestOtp}
              style={[styles.secondaryButton, styles.inlineButton]}
            >
              <Text style={styles.secondaryButtonText}>New OTP</Text>
            </Pressable>
          </View>

          <Text style={styles.hintText}>
            Use demo OTPs: 111111 invalid, 000000 expired, 999999 key
            provisioning required, 123456 success.
          </Text>
        </View>
      ) : null}

      {authStatus ? (
        <View
          style={[
            styles.card,
            authStatus.kind === 'verified' ? styles.successCard : styles.errorCard,
          ]}
        >
          <Text style={styles.sectionTitle}>{authStatus.title}</Text>
          <Text style={styles.bodyText}>{authStatus.message}</Text>

          {authStatus.kind === 'key-provisioning' ? (
            <Pressable
              accessibilityLabel="Complete key provisioning"
              onPress={() => {
                setIsKeyProvisionedOverride(true);
                setAuthStatus(null);
              }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Complete key provisioning</Text>
            </Pressable>
          ) : null}

          {authStatus.kind === 'verified' ? (
            <Pressable
              accessibilityLabel="Continue to role home"
              onPress={continueToHome}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Retry authentication"
              onPress={() => {
                setAuthStatus(null);
                setOtpCode('');
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {showHome && activeSession ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Role-Aware Navigation</Text>
          <Text style={styles.valueText}>{activeSession.displayName}</Text>
          <Text style={styles.metaText}>Active role: {activeSession.activeRole}</Text>

          <Text style={[styles.label, styles.blockTop]}>Allowed screens</Text>
          <View style={styles.roleGrid}>
            {OPERATIONS_SCREENS.map(screen => {
              const allowed = roleAllowedScreens.includes(screen);
              const selected = selectedOperationScreen === screen;

              return (
                <Pressable
                  key={screen}
                  accessibilityLabel={`Open ${screen}`}
                  disabled={!allowed}
                  onPress={() => setSelectedOperationScreen(screen)}
                  style={[
                    styles.roleButton,
                    allowed ? null : styles.roleButtonDisabled,
                    selected ? styles.roleButtonActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleButtonText,
                      allowed ? null : styles.roleButtonTextDisabled,
                      selected ? styles.roleButtonTextActive : null,
                    ]}
                  >
                    {screen}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.previewPanel}>
            <Text style={styles.previewTitle}>{selectedOperationScreen}</Text>
            <Text style={styles.previewBody}>
              {roleAllowedScreens.includes(selectedOperationScreen)
                ? 'Access granted for this role.'
                : 'Access denied for this role.'}
            </Text>
          </View>

          <Pressable
            accessibilityLabel="Sign out"
            onPress={resetFlow}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f3efe7',
    gap: 12,
    padding: 18,
  },
  heroCard: {
    backgroundColor: '#113d3a',
    borderRadius: 20,
    gap: 8,
    padding: 18,
  },
  eyebrow: {
    color: '#8fd0c6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#f3f7f4',
    fontSize: 23,
    fontWeight: '800',
  },
  heroBody: {
    color: '#d4e1de',
    fontSize: 14,
    lineHeight: 20,
  },
  stateChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#d8efe7',
    borderRadius: 999,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stateChipText: {
    color: '#174a45',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 20,
    gap: 8,
    padding: 16,
  },
  successCard: {
    borderColor: '#3ca87f',
    borderWidth: 1,
  },
  errorCard: {
    borderColor: '#c45d4d',
    borderWidth: 1,
  },
  sectionTitle: {
    color: '#152a27',
    fontSize: 18,
    fontWeight: '800',
  },
  label: {
    color: '#4d5a57',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  valueText: {
    color: '#101c1b',
    fontSize: 18,
    fontWeight: '700',
  },
  metaText: {
    color: '#5c6764',
    fontSize: 13,
  },
  bodyText: {
    color: '#24312f',
    fontSize: 14,
    lineHeight: 20,
  },
  blockTop: {
    marginTop: 4,
  },
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleButton: {
    alignItems: 'center',
    backgroundColor: '#e7ddd0',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 132,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  roleButtonActive: {
    backgroundColor: '#0d6f67',
  },
  roleButtonDisabled: {
    backgroundColor: '#ddd9d3',
    opacity: 0.7,
  },
  roleButtonText: {
    color: '#253633',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  roleButtonTextActive: {
    color: '#f0fffb',
  },
  roleButtonTextDisabled: {
    color: '#70736f',
  },
  otpInput: {
    backgroundColor: '#ffffff',
    borderColor: '#c6c2ba',
    borderRadius: 12,
    borderWidth: 1,
    color: '#14201f',
    fontSize: 18,
    letterSpacing: 3,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineButton: {
    flex: 1,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0d6f67',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#f1fbf9',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#e4e8ec',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#1d2f35',
    fontSize: 15,
    fontWeight: '700',
  },
  hintText: {
    color: '#51625f',
    fontSize: 12,
    lineHeight: 17,
  },
  previewPanel: {
    backgroundColor: '#f7f2ea',
    borderRadius: 12,
    gap: 6,
    marginTop: 6,
    padding: 12,
  },
  previewTitle: {
    color: '#22322f',
    fontSize: 16,
    fontWeight: '700',
  },
  previewBody: {
    color: '#495753',
    fontSize: 13,
  },
});
