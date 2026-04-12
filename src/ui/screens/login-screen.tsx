import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestOtp, verifyOtp } from '../../api/auth';
import type { RegisteredUser } from '../../api/auth';
import type { IssuedOfflineOtpRecord } from '../../core/contracts';

const ROLE_LABELS: Record<string, string> = {
  FIELD_VOLUNTEER: 'Field Volunteer',
  SUPPLY_MANAGER: 'Supply Manager',
  DRONE_OPERATOR: 'Drone Operator',
  CAMP_COMMANDER: 'Camp Commander',
  SYNC_ADMIN: 'Sync Admin',
};

type Props = {
  user: RegisteredUser;
  onLoggedIn: () => void;
  onSwitchToRegister: () => void;
};

export default function LoginScreen({
  user,
  onLoggedIn,
  onSwitchToRegister,
}: Props) {
  const [otpSession, setOtpSession] = useState<IssuedOfflineOtpRecord | null>(
    null,
  );
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const otpCode = otpDigits.join('');

  // Countdown timer for OTP expiry
  useEffect(() => {
    if (!otpSession) {
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(
        0,
        Math.ceil((otpSession.expiresAtMs - Date.now()) / 1000),
      );
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [otpSession]);

  const handleGenerateOtp = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOtpDigits(['', '', '', '', '', '']);

    try {
      const session = await requestOtp(user.userId, user.deviceId, user.role);
      setOtpSession(session);
      // Focus the first input after generating
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate OTP');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      if (value.length > 1) {
        // Handle paste - spread digits across inputs
        const digits = value.replace(/\D/g, '').slice(0, 6).split('');
        const updated = [...otpDigits];
        digits.forEach((d, i) => {
          if (index + i < 6) {
            updated[index + i] = d;
          }
        });
        setOtpDigits(updated);
        const nextFocus = Math.min(index + digits.length, 5);
        inputRefs.current[nextFocus]?.focus();
        return;
      }

      const digit = value.replace(/\D/g, '');
      const updated = [...otpDigits];
      updated[index] = digit;
      setOtpDigits(updated);

      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [otpDigits],
  );

  const handleDigitKeyPress = useCallback(
    (index: number, key: string) => {
      if (key === 'Backspace' && !otpDigits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [otpDigits],
  );

  const handleVerify = useCallback(async () => {
    if (!otpSession || otpCode.length !== 6) {
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const result = await verifyOtp(otpSession.otpSessionId, otpCode);
      if (result.verified) {
        onLoggedIn();
      } else {
        setError(
          result.failureReason === 'otp_expired'
            ? 'OTP has expired. Generate a new code.'
            : result.failureReason === 'otp_mismatch'
            ? 'Incorrect code. Please try again.'
            : `Verification failed: ${result.failureReason ?? 'unknown'}`,
        );
        setOtpDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }, [otpSession, otpCode, onLoggedIn]);

  const isExpired = otpSession !== null && timeLeft <= 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>DIGITAL DELTA</Text>
          <Text style={styles.title}>Secure Login</Text>
          <Text style={styles.subtitle}>
            Authenticate using offline TOTP verification
          </Text>
        </View>

        {/* User Identity Card */}
        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.identityInfo}>
            <Text style={styles.identityName}>{user.displayName}</Text>
            <Text style={styles.identityDetail}>
              {ROLE_LABELS[user.role] ?? user.role}
            </Text>
            <Text style={styles.identityId}>{user.userId}</Text>
          </View>
        </View>

        {/* OTP Section */}
        {!otpSession ? (
          <View style={styles.otpPrompt}>
            <Text style={styles.otpPromptText}>
              Generate a time-based one-time password to verify your identity.
              The code is created locally on your device.
            </Text>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleGenerateOtp}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Generating...' : 'Generate OTP'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.otpSection}>
            {/* Demo OTP Display */}
            <View style={styles.demoCodeCard}>
              <Text style={styles.demoCodeLabel}>YOUR OTP CODE</Text>
              <Text style={styles.demoCode}>{otpSession.code}</Text>
              <View style={styles.timerRow}>
                <View
                  style={[
                    styles.timerDot,
                    isExpired ? styles.timerDotExpired : styles.timerDotActive,
                  ]}
                />
                <Text
                  style={[
                    styles.timerText,
                    isExpired && styles.timerTextExpired,
                  ]}
                >
                  {isExpired
                    ? 'Expired — generate a new code'
                    : `Expires in ${timeLeft}s`}
                </Text>
              </View>
            </View>

            {/* OTP Input */}
            <Text style={styles.inputLabel}>Enter the code below</Text>
            <View style={styles.otpInputRow}>
              {otpDigits.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={ref => {
                    inputRefs.current[index] = ref;
                  }}
                  style={[
                    styles.otpInput,
                    digit ? styles.otpInputFilled : null,
                  ]}
                  value={digit}
                  onChangeText={v => handleDigitChange(index, v)}
                  onKeyPress={({ nativeEvent }) =>
                    handleDigitKeyPress(index, nativeEvent.key)
                  }
                  keyboardType="number-pad"
                  maxLength={6}
                  selectTextOnFocus
                  editable={!verifying && !isExpired}
                />
              ))}
            </View>

            {/* Verify / Regenerate */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.button,
                  (otpCode.length !== 6 || verifying || isExpired) &&
                    styles.buttonDisabled,
                ]}
                onPress={handleVerify}
                activeOpacity={0.8}
                disabled={otpCode.length !== 6 || verifying || isExpired}
              >
                <Text style={styles.buttonText}>
                  {verifying ? 'Verifying...' : 'Verify & Login'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleGenerateOtp}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Regenerate OTP</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Error */}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Switch account */}
        <TouchableOpacity
          style={styles.switchLink}
          onPress={onSwitchToRegister}
          activeOpacity={0.7}
        >
          <Text style={styles.switchText}>Register a new identity</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#faf8ff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    marginTop: 16,
    marginBottom: 28,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#0058be',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#131b2e',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#565e74',
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f3ff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 28,
    gap: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0058be',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  identityInfo: {
    flex: 1,
  },
  identityName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 2,
  },
  identityDetail: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0058be',
    marginBottom: 2,
  },
  identityId: {
    fontSize: 11,
    color: '#9da3b0',
    fontFamily: 'monospace',
  },
  otpPrompt: {
    gap: 16,
    marginBottom: 20,
  },
  otpPromptText: {
    fontSize: 14,
    color: '#565e74',
    lineHeight: 21,
  },
  otpSection: {
    gap: 16,
    marginBottom: 20,
  },
  demoCodeCard: {
    backgroundColor: '#131b2e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  demoCodeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#9da3b0',
  },
  demoCode: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 8,
    fontFamily: 'monospace',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timerDotActive: {
    backgroundColor: '#4ade80',
  },
  timerDotExpired: {
    backgroundColor: '#ef4444',
  },
  timerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9da3b0',
  },
  timerTextExpired: {
    color: '#ef4444',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#131b2e',
  },
  otpInputRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#f2f3ff',
    borderWidth: 2,
    borderColor: '#c2c6d6',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: '#131b2e',
  },
  otpInputFilled: {
    borderColor: '#0058be',
    backgroundColor: '#e8ecff',
  },
  actionRow: {
    gap: 12,
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
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0058be',
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#ffdad6',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#93000a',
    fontWeight: '600',
  },
  switchLink: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  switchText: {
    fontSize: 14,
    color: '#565e74',
    textDecorationLine: 'underline',
  },
});
