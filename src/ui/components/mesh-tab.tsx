import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  type MeshMessage,
  type NodeRole,
  type NodeRoleLogEntry,
  deliverIncomingMessages,
  evaluateAndLogRole,
  getMeshMessages,
  getMeshStats,
  getNodeRoleLog,
  sendMeshMessage,
  simulateRelayHop,
} from '../../api/mesh';

type Props = {
  user: RegisteredUser;
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#d69e2e',
  in_transit: '#3182ce',
  delivered: '#38a169',
  expired: '#e53e3e',
};

const ROLE_COLOR: Record<NodeRole, string> = {
  client: '#805ad5',
  relay: '#0058be',
};

export function MeshTab({ user }: Props) {
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [roleLog, setRoleLog] = useState<NodeRoleLogEntry[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    pending: number;
    inTransit: number;
    delivered: number;
    expired: number;
    currentRole: NodeRole | null;
  } | null>(null);

  const [messageText, setMessageText] = useState('');
  const [sendDestSelf, setSendDestSelf] = useState(true);
  const [loading, setLoading] = useState(false);
  const [battery, setBattery] = useState(75);
  const [signal, setSignal] = useState(-65);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    const [msgs, logs, st] = await Promise.all([
      getMeshMessages(),
      getNodeRoleLog(),
      getMeshStats(user.deviceId),
    ]);
    setMessages(msgs);
    setRoleLog(logs);
    setStats(st);
  }, [user.deviceId]);

  useEffect(() => {
    loadData();
    // Evaluate initial role
    evaluateAndLogRole(user, 75, -65).then(() => loadData());
  }, [loadData, user]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setLoading(true);
      try {
        await action();
        await loadData();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [loadData],
  );

  const handleSend = useCallback(() => {
    if (!messageText.trim()) {
      return;
    }
    runAction(async () => {
      const dest = sendDestSelf
        ? user.deviceId
        : `VIRTUAL-${user.deviceId.slice(-4)}`;
      await sendMeshMessage(user, {
        text: messageText.trim(),
        destinationDeviceId: dest,
      });
      setMessageText('');
    });
  }, [messageText, sendDestSelf, user, runAction]);

  const handleRelay = useCallback(() => {
    runAction(async () => {
      const result = await simulateRelayHop(user);
      Alert.alert(
        'Relay Hop Complete',
        `Relay device: ${result.relayDeviceId}\n` +
          `Forwarded: ${result.relayed} message(s)\n` +
          `Expired (TTL=0): ${result.expired}`,
      );
    });
  }, [user, runAction]);

  const handleDeliver = useCallback(() => {
    runAction(async () => {
      const result = await deliverIncomingMessages(user);
      Alert.alert(
        'Delivery Attempt',
        `Decrypted & delivered: ${result.delivered}\n` +
          `Failed (wrong key / tampered): ${result.failed}`,
      );
    });
  }, [user, runAction]);

  const handleRoleSwitch = useCallback(
    (newBattery: number, newSignal: number) => {
      setBattery(newBattery);
      setSignal(newSignal);
      runAction(() => evaluateAndLogRole(user, newBattery, newSignal));
    },
    [user, runAction],
  );

  const currentRole = stats?.currentRole;

  return (
    <View>
      {/* Header */}
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>STORE-AND-FORWARD · E2E ENCRYPTED</Text>
        <Text style={styles.title}>Mesh Network</Text>
        <Text style={styles.subtitle}>
          Messages are encrypted with the recipient's X25519 key (derived from
          Ed25519 seed). Relay nodes forward packets without being able to read
          their contents.
        </Text>
      </View>

      {/* Node role banner */}
      <View
        style={[
          styles.roleBanner,
          {
            backgroundColor: currentRole
              ? ROLE_COLOR[currentRole] + '18'
              : '#f2f3ff',
          },
        ]}
      >
        <View style={styles.roleLeft}>
          <Text style={styles.roleLabel}>THIS DEVICE</Text>
          <Text
            style={[
              styles.roleValue,
              { color: currentRole ? ROLE_COLOR[currentRole] : '#131b2e' },
            ]}
          >
            {currentRole ? currentRole.toUpperCase() : '—'}
          </Text>
        </View>
        <View style={styles.roleRight}>
          <Text style={styles.roleMeta}>
            🔋 {battery}% 📶 {signal} dBm
          </Text>
        </View>
      </View>

      {/* Role switch presets */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Simulate Role Switch (M3.2)</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[
              styles.chip,
              battery >= 50 && signal >= -70 && styles.chipActive,
            ]}
            onPress={() => handleRoleSwitch(85, -60)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.chipText,
                battery >= 50 && signal >= -70 && styles.chipTextActive,
              ]}
            >
              Good Conditions → RELAY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, battery < 30 && styles.chipActive]}
            onPress={() => handleRoleSwitch(20, -65)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, battery < 30 && styles.chipTextActive]}
            >
              Low Battery → CLIENT
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, signal < -80 && styles.chipActive]}
            onPress={() => handleRoleSwitch(70, -85)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, signal < -80 && styles.chipTextActive]}
            >
              Weak Signal → CLIENT
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats */}
      {stats && (
        <View style={styles.statsRow}>
          <StatBox label="Total" value={stats.total} color="#131b2e" />
          <StatBox label="Pending" value={stats.pending} color="#d69e2e" />
          <StatBox label="In Transit" value={stats.inTransit} color="#3182ce" />
          <StatBox label="Delivered" value={stats.delivered} color="#38a169" />
          <StatBox label="Expired" value={stats.expired} color="#e53e3e" />
        </View>
      )}

      {/* Compose */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Compose Message (M3.3)</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Enter encrypted message…"
          placeholderTextColor="#9da3b0"
          value={messageText}
          onChangeText={setMessageText}
          multiline
          editable={!loading}
        />
        <View style={styles.destRow}>
          <TouchableOpacity
            style={[styles.chip, sendDestSelf && styles.chipActive]}
            onPress={() => setSendDestSelf(true)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, sendDestSelf && styles.chipTextActive]}
            >
              → Self (verify decrypt)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, !sendDestSelf && styles.chipActive]}
            onPress={() => setSendDestSelf(false)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, !sendDestSelf && styles.chipTextActive]}
            >
              → Virtual Remote Device
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[
            styles.btnPrimary,
            (!messageText.trim() || loading) && styles.btnDisabled,
          ]}
          onPress={handleSend}
          disabled={!messageText.trim() || loading}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>
            {loading ? 'Sending…' : '🔒 Encrypt & Send'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Relay & Deliver actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[
            styles.btnSecondary,
            styles.btnHalf,
            loading && styles.btnDisabled,
          ]}
          onPress={handleRelay}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.btnSecondaryText}>⟳ Simulate Relay Hop</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.btnSecondary,
            styles.btnHalf,
            loading && styles.btnDisabled,
          ]}
          onPress={handleDeliver}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.btnSecondaryText}>📬 Deliver to Self</Text>
        </TouchableOpacity>
      </View>

      {/* Message list */}
      {messages.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Message Log</Text>
          {messages.map(msg => (
            <MessageCard
              key={msg.messageId}
              msg={msg}
              localDeviceId={user.deviceId}
            />
          ))}
        </View>
      )}

      {/* Role log */}
      {roleLog.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Role Switch Log (M3.2)</Text>
          {roleLog.slice(0, 5).map(entry => (
            <View key={entry.logId} style={styles.logEntry}>
              <View style={styles.logLeft}>
                <View
                  style={[
                    styles.roleDot,
                    { backgroundColor: ROLE_COLOR[entry.role] },
                  ]}
                />
                <Text style={styles.logRole}>{entry.role.toUpperCase()}</Text>
              </View>
              <Text style={styles.logReason} numberOfLines={2}>
                {entry.reason}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* How it works */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Demo walkthrough</Text>
        <Text style={styles.infoText}>
          {'1. Type a message → "Encrypt & Send" (→ Self)\n' +
            '   Stored as PENDING with ciphertext only\n\n' +
            '2. "Simulate Relay Hop" — a virtual relay device\n' +
            '   picks up PENDING messages, decrements TTL,\n' +
            '   marks IN_TRANSIT. Relay cannot read payload.\n\n' +
            '3. "Deliver to Self" — decrypts with your X25519 key\n' +
            '   derived from your Ed25519 seed. Relay has no key.\n\n' +
            '4. Tap role presets to simulate role switching.\n' +
            '   Each switch is logged with battery & signal context.'}
        </Text>
      </View>
    </View>
  );
}

function MessageCard({
  msg,
  localDeviceId,
}: {
  msg: MeshMessage;
  localDeviceId: string;
}) {
  const color = STATUS_COLOR[msg.status] ?? '#131b2e';
  const isLocal = msg.originDeviceId === localDeviceId;
  const isForMe = msg.destinationDeviceId === localDeviceId;

  return (
    <View style={styles.msgCard}>
      <View style={styles.msgTop}>
        <View style={[styles.statusBadge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.statusText, { color }]}>
            {msg.status.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.msgMeta}>
          TTL: {msg.ttlHops} Hops: {msg.hopCount}
        </Text>
      </View>

      <View style={styles.msgRoute}>
        <Text style={styles.msgRouteText} numberOfLines={1}>
          {msg.originDeviceId.slice(-8)} → {msg.destinationDeviceId.slice(-8)}
        </Text>
        {msg.relayDeviceId && (
          <Text style={styles.msgRelayText} numberOfLines={1}>
            via {msg.relayDeviceId.slice(-10)}
          </Text>
        )}
      </View>

      {/* Ciphertext preview (relay sees this) */}
      <View style={styles.cipherBox}>
        <Text style={styles.cipherLabel}>CIPHERTEXT (relay sees)</Text>
        <Text style={styles.cipherText} numberOfLines={2}>
          {msg.ciphertextHex.slice(0, 64)}…
        </Text>
      </View>

      {/* Plaintext only shown after delivery */}
      {msg.plaintextPreview !== null && (
        <View style={styles.plaintextBox}>
          <Text style={styles.plaintextLabel}>
            ✓ DECRYPTED (recipient only)
          </Text>
          <Text style={styles.plaintextText}>{msg.plaintextPreview}</Text>
        </View>
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
    color: '#0058be',
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#131b2e', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#565e74', lineHeight: 19 },
  roleBanner: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  roleLeft: { gap: 2 },
  roleLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9da3b0',
    letterSpacing: 1,
  },
  roleValue: { fontSize: 20, fontWeight: '800' },
  roleRight: {},
  roleMeta: { fontSize: 13, color: '#565e74' },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  statBox: {
    flex: 1,
    minWidth: 55,
    backgroundColor: '#f2f3ff',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statNum: { fontSize: 16, fontWeight: '800' },
  statLbl: { fontSize: 10, color: '#565e74', marginTop: 2 },
  textInput: {
    backgroundColor: '#f2f3ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#131b2e',
    borderWidth: 1,
    borderColor: '#c2c6d6',
    marginBottom: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  destRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f2f3ff',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  chipActive: { backgroundColor: '#0058be', borderColor: '#0058be' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#565e74' },
  chipTextActive: { color: '#fff' },
  btnPrimary: {
    backgroundColor: '#0058be',
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
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  btnHalf: { flex: 1 },
  msgCard: {
    backgroundColor: '#f8f9ff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e4e6f0',
    gap: 8,
  },
  msgTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  msgMeta: { fontSize: 11, color: '#9da3b0' },
  msgRoute: { gap: 2 },
  msgRouteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#131b2e',
    fontFamily: 'monospace',
  },
  msgRelayText: { fontSize: 11, color: '#0058be', fontFamily: 'monospace' },
  cipherBox: {
    backgroundColor: '#131b2e',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  cipherLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9da3b0',
    letterSpacing: 1,
  },
  cipherText: {
    fontSize: 10,
    color: '#4ade80',
    fontFamily: 'monospace',
    lineHeight: 15,
  },
  plaintextBox: {
    backgroundColor: '#f0fff4',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#38a169',
    gap: 4,
  },
  plaintextLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#38a169',
    letterSpacing: 1,
  },
  plaintextText: { fontSize: 13, fontWeight: '600', color: '#131b2e' },
  logEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f8f9ff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    gap: 10,
  },
  logLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 70 },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  logRole: { fontSize: 11, fontWeight: '800', color: '#131b2e' },
  logReason: { flex: 1, fontSize: 11, color: '#565e74', lineHeight: 16 },
  infoBox: {
    backgroundColor: '#f2f3ff',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0058be',
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#131b2e',
    marginBottom: 6,
  },
  infoText: { fontSize: 12, color: '#565e74', lineHeight: 18 },
});
