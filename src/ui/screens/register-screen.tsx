import React, { useState } from 'react';
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

import type { AppRole } from '../../core/contracts';
import { registerUser, type RegisteredUser } from '../../api/auth';

const ROLES: { value: AppRole; label: string; description: string }[] = [
  {
    value: 'FIELD_VOLUNTEER',
    label: 'Field Volunteer',
    description: 'On-ground relief distribution and status reporting',
  },
  {
    value: 'SUPPLY_MANAGER',
    label: 'Supply Manager',
    description: 'Inventory tracking, delivery coordination, and triage',
  },
  {
    value: 'DRONE_OPERATOR',
    label: 'Drone Operator',
    description: 'Aerial delivery and last-mile handoff operations',
  },
  {
    value: 'CAMP_COMMANDER',
    label: 'Camp Commander',
    description: 'Relief camp oversight and supply receipt verification',
  },
  {
    value: 'SYNC_ADMIN',
    label: 'Sync Admin',
    description: 'System administration, mesh network, and data sync',
  },
];

type Props = {
  onRegistered: (user: RegisteredUser) => void;
};

export default function RegisterScreen({ onRegistered }: Props) {
  const [name, setName] = useState('');
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    name.trim().length >= 2 && selectedRole !== null && !loading;

  const handleRegister = async () => {
    if (!canSubmit || !selectedRole) {
      return;
    }

    setLoading(true);
    try {
      const user = await registerUser({
        displayName: name.trim(),
        role: selectedRole,
      });
      onRegistered(user);
    } catch (error) {
      Alert.alert(
        'Registration Failed',
        error instanceof Error ? error.message : 'An unexpected error occurred',
      );
    } finally {
      setLoading(false);
    }
  };

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
          <Text style={styles.title}>Create Your Identity</Text>
          <Text style={styles.subtitle}>
            Register to join the decentralized relief coordination network. Your
            device will generate a unique cryptographic identity.
          </Text>
        </View>

        {/* Name Input */}
        <View style={styles.section}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Enter your full name"
            placeholderTextColor="#9da3b0"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!loading}
          />
        </View>

        {/* Role Selection */}
        <View style={styles.section}>
          <Text style={styles.label}>Assigned Role</Text>
          <Text style={styles.hint}>
            Select the role that matches your field assignment
          </Text>
          <View style={styles.roleList}>
            {ROLES.map(role => {
              const isSelected = selectedRole === role.value;
              return (
                <TouchableOpacity
                  key={role.value}
                  style={[
                    styles.roleCard,
                    isSelected && styles.roleCardSelected,
                  ]}
                  onPress={() => setSelectedRole(role.value)}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.roleLabel,
                      isSelected && styles.roleLabelSelected,
                    ]}
                  >
                    {role.label}
                  </Text>
                  <Text
                    style={[
                      styles.roleDesc,
                      isSelected && styles.roleDescSelected,
                    ]}
                  >
                    {role.description}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Security Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What happens on registration</Text>
          <Text style={styles.infoText}>
            {'• Ed25519 key pair generated for your device\n' +
              '• TOTP secret created for offline authentication\n' +
              '• All events logged to tamper-evident audit trail\n' +
              '• Zero data sent to any external server'}
          </Text>
        </View>

        {/* Register Button */}
        <TouchableOpacity
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleRegister}
          activeOpacity={0.8}
          disabled={!canSubmit}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Registering...' : 'Register & Generate Keys'}
          </Text>
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
    marginBottom: 32,
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#565e74',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: '#565e74',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#131b2e',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  roleList: {
    gap: 10,
  },
  roleCard: {
    backgroundColor: '#f2f3ff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleCardSelected: {
    backgroundColor: '#0058be',
    borderColor: '#0058be',
  },
  roleLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 4,
  },
  roleLabelSelected: {
    color: '#ffffff',
  },
  roleDesc: {
    fontSize: 13,
    color: '#565e74',
    lineHeight: 18,
  },
  roleDescSelected: {
    color: '#dae2fd',
  },
  infoCard: {
    backgroundColor: '#f2f3ff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#0058be',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#565e74',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#0058be',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    backgroundColor: '#c2c6d6',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
