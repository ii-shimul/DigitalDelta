import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import type { RegisteredUser } from '../../api/auth';
import {
  createSignedDelivery,
  getDeliveries,
  getLastSignedQrForReplay,
  getReceipts,
  verifyAndCountersign,
  type PodDelivery,
  type PodReceipt,
} from '../../api/pod';

type Props = { user: RegisteredUser };

const DEMO_PAYLOADS = [
  {
    label: 'Medical Supplies',
    cargoDescription: 'IV fluids x20, bandages x50, morphine x10',
    recipientNodeId: 'node-dhaka',
  },
  {
    label: 'Food Rations',
    cargoDescription: 'Rice 100kg, canned goods 200 units, water 500L',
    recipientNodeId: 'node-sylhet',
  },
  {
    label: 'Rescue Equipment',
    cargoDescription: 'Rope 200m, harness x5, headlamps x10',
    recipientNodeId: 'node-cox',
  },
];

function buildQrHtml(value: string): string {
  // Inline QR code via Google Charts (offline fallback shows hex)
  const safe = encodeURIComponent(value);
  const hexPreview = value.length > 60 ? value.slice(0, 60) + '…' : value;
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { margin:0; background:#fff; display:flex; flex-direction:column;
         align-items:center; justify-content:center; min-height:100vh; padding:8px; }
  img { width:200px; height:200px; border:2px solid #333; border-radius:4px; }
  .err { font-family:monospace; font-size:9px; word-break:break-all; color:#555; margin-top:8px; }
</style>
</head>
<body>
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${safe}"
       onerror="this.style.display='none'; document.getElementById('fallback').style.display='block'"/>
  <div id="fallback" style="display:none">
    <div class="err">${hexPreview}</div>
    <div style="font-size:10px;color:#888;margin-top:4px;">(QR needs network)</div>
  </div>
</body>
</html>`;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#718096',
  signed: '#3182ce',
  verified: '#d69e2e',
  completed: '#38a169',
};

export function PodTab({ user }: Props) {
  const [deliveries, setDeliveries] = useState<PodDelivery[]>([]);
  const [receipts, setReceipts] = useState<PodReceipt[]>([]);
  const [qrModal, setQrModal] = useState<{
    visible: boolean;
    qrJson: string;
    label: string;
  }>({
    visible: false,
    qrJson: '',
    label: '',
  });
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([getDeliveries(), getReceipts()]);
    setDeliveries(d);
    setReceipts(r);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async (idx: number) => {
    setLoading(true);
    setVerifyResult(null);
    try {
      const p = DEMO_PAYLOADS[idx]!;
      const delivery = await createSignedDelivery(user, p);
      await load();
      setQrModal({
        visible: true,
        qrJson: delivery.qrPayload!,
        label: delivery.label,
      });
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    const last = deliveries.find(d => d.status === 'signed') ?? deliveries[0];
    if (!last) {
      Alert.alert('No delivery', 'Generate a delivery first.');
      return;
    }
    setLoading(true);
    try {
      // Find the qr payload from the last delivery by re-querying signed nonce
      // We store it in the closed-over qrModal but also allow direct verify:
      const qrJson = qrModal.qrJson || (await getLastSignedQrForReplay());
      if (!qrJson) {
        Alert.alert('No QR', 'Generate a delivery first.');
        return;
      }
      const { result, receiptId } = await verifyAndCountersign(user, qrJson);
      if (result.ok) {
        setVerifyResult(`✓ VERIFIED — receipt ${receiptId}`);
      } else {
        setVerifyResult(`✗ ${result.error}`);
      }
      await load();
    } catch (e: unknown) {
      Alert.alert('Verify Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleReplay = async () => {
    setLoading(true);
    try {
      const qrJson = await getLastSignedQrForReplay();
      if (!qrJson) {
        Alert.alert('No delivery', 'Generate and verify a delivery first.');
        return;
      }
      const { result } = await verifyAndCountersign(user, qrJson);
      if (result.ok) {
        setVerifyResult('⚠ REPLAY MISSED (unexpected)');
      } else {
        setVerifyResult(`🔒 REPLAY BLOCKED — ${result.error}`);
      }
    } catch (e: unknown) {
      Alert.alert('Replay Error', String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* QR modal */}
      <Modal visible={qrModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>PoD QR — {qrModal.label}</Text>
            <View style={styles.qrBox}>
              <WebView
                style={styles.qrWebView}
                source={{ html: buildQrHtml(qrModal.qrJson) }}
                scrollEnabled={false}
                originWhitelist={['*']}
              />
            </View>
            <Text style={styles.qrHint}>
              Payload: {qrModal.qrJson.length} bytes · Ed25519 signed
            </Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setQrModal(s => ({ ...s, visible: false }))}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Generate Signed PoD</Text>
        <View style={styles.row}>
          {DEMO_PAYLOADS.map((p, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.genBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => handleGenerate(i)}
            >
              <Text style={styles.genBtnText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Verify / replay */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verification</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.verifyBtn,
              loading && styles.disabled,
            ]}
            disabled={loading}
            onPress={handleVerify}
          >
            <Text style={styles.actionBtnText}>▶ Verify (Simulate Scan)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.replayBtn,
              loading && styles.disabled,
            ]}
            disabled={loading}
            onPress={handleReplay}
          >
            <Text style={styles.actionBtnText}>⚡ Replay Attack Demo</Text>
          </TouchableOpacity>
        </View>
        {verifyResult !== null && (
          <View
            style={[
              styles.resultBadge,
              verifyResult.startsWith('✓') && styles.resultOk,
              verifyResult.startsWith('✗') && styles.resultFail,
              verifyResult.startsWith('🔒') && styles.resultBlock,
            ]}
          >
            <Text style={styles.resultText}>{verifyResult}</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.listScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Deliveries */}
        <Text style={styles.sectionTitle}>
          Deliveries ({deliveries.length})
        </Text>
        {deliveries.map(d => (
          <TouchableOpacity
            key={d.deliveryId}
            style={styles.card}
            onPress={() => {
              if (d.signatureHex) {
                // Re-show QR for this delivery (reconstruct from stored data)
                const payload = JSON.stringify({
                  delivery_id: d.deliveryId,
                  sender_pubkey: d.senderPubHex,
                  payload_hash: d.payloadHash,
                  nonce: d.nonceHex,
                  timestamp: d.createdAtMs,
                  label: d.label,
                  recipient_node_id: d.recipientNodeId ?? '',
                  signature: d.signatureHex,
                });
                setQrModal({ visible: true, qrJson: payload, label: d.label });
              }
            }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{d.label}</Text>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: STATUS_COLOR[d.status] ?? '#999' },
                ]}
              >
                <Text style={styles.badgeText}>{d.status.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>{d.deliveryId}</Text>
            <Text style={styles.cardMeta}>
              → {d.recipientNodeId ?? 'unknown'}
            </Text>
            <Text style={styles.cardHash} numberOfLines={1}>
              hash: {d.payloadHash.slice(0, 20)}…
            </Text>
            {d.status === 'signed' && (
              <Text style={styles.tapHint}>Tap to view QR</Text>
            )}
          </TouchableOpacity>
        ))}

        {/* Receipts */}
        {receipts.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>
              Receipt Chain ({receipts.length})
            </Text>
            {receipts.map(r => (
              <View key={r.receiptId} style={[styles.card, styles.receiptCard]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{r.receiptId}</Text>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor:
                          r.status === 'verified' ? '#38a169' : '#e53e3e',
                      },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {r.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>Delivery: {r.deliveryId}</Text>
                <Text style={styles.cardHash} numberOfLines={1}>
                  hash: {r.payloadHash.slice(0, 20)}…
                </Text>
                <Text style={styles.cardMeta}>
                  {r.verifiedAtMs
                    ? new Date(r.verifiedAtMs).toLocaleTimeString()
                    : '—'}
                </Text>
              </View>
            ))}
          </>
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e1a' },
  section: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  sectionTitle: {
    color: '#90cdf4',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genBtn: {
    backgroundColor: '#2d3748',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#4a5568',
  },
  genBtnText: { color: '#e2e8f0', fontSize: 11, fontWeight: '600' },
  actionBtn: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 6,
  },
  verifyBtn: { backgroundColor: '#2b6cb0' },
  replayBtn: { backgroundColor: '#742a2a' },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  resultBadge: {
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#2d3748',
  },
  resultOk: { backgroundColor: '#1a4731' },
  resultFail: { backgroundColor: '#6b1e1e' },
  resultBlock: { backgroundColor: '#4a1942' },
  resultText: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  listScroll: { flex: 1 },
  card: {
    backgroundColor: '#1a2035',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2d3748',
  },
  receiptCard: { borderColor: '#4a5568', borderStyle: 'dashed' },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700', flex: 1 },
  cardMeta: { color: '#718096', fontSize: 10, marginBottom: 1 },
  cardHash: { color: '#4a5568', fontSize: 9, fontFamily: 'monospace' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  tapHint: { color: '#4299e1', fontSize: 10, marginTop: 4 },
  bottomPad: { height: 24 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#1a2035',
    borderRadius: 12,
    padding: 16,
    width: 280,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a5568',
  },
  modalTitle: {
    color: '#90cdf4',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 12,
  },
  qrBox: {
    width: 216,
    height: 216,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  qrWebView: { flex: 1, backgroundColor: '#fff' },
  qrHint: {
    color: '#718096',
    fontSize: 10,
    marginBottom: 12,
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: '#2d3748',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  closeBtnText: { color: '#e2e8f0', fontWeight: '700' },
});
