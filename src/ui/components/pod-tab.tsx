import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import type { RegisteredUser } from '../../api/auth';
import { getAllUsers } from '../../api/auth';
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

function buildQrHtml(value: string): string {
  // Fully offline QR code generation using inline qrcode.js algorithm
  // No external API calls — works completely offline (C4 compliance)
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { margin:0; background:#fff; display:flex; flex-direction:column;
         align-items:center; justify-content:center; min-height:100vh; padding:8px; }
  canvas { border:2px solid #333; border-radius:4px; }
  .hex { font-family:monospace; font-size:9px; word-break:break-all; color:#555; margin-top:8px; max-width:240px; text-align:center; }
</style>
</head>
<body>
<canvas id="qr" width="200" height="200"></canvas>
<div class="hex" id="info"></div>
<script>
// Minimal QR Code generator (Mode Byte, ECC-L, versions 1-40)
// Based on Project Nayuki QR Code generator (MIT License)
(function(){
  var QR={};
  // Error correction codewords per block for ECC level L
  var ECC_CODEWORDS_PER_BLOCK=[null,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30];
  var NUM_ERROR_CORRECTION_BLOCKS=[null,1,1,1,1,1,2,2,2,2,4,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24];
  function getNumDataCodewords(ver){var total=((16*ver+128)*ver+64)/8;var ecc=ECC_CODEWORDS_PER_BLOCK[ver]*NUM_ERROR_CORRECTION_BLOCKS[ver];return total-ecc;}
  function getNumRawDataModules(ver){var result=(16*ver+128)*ver+64;if(ver>=2){var numAlign=Math.floor(ver/7)+2;result-=(25*numAlign-10)*numAlign-55;if(ver>=7)result-=36;}return result;}

  function reedSolomonComputeDivisor(degree){
    var result=[];for(var i=0;i<degree-1;i++)result.push(0);result.push(1);
    var root=1;
    for(var i=0;i<degree;i++){
      for(var j=0;j<result.length;j++){
        result[j]=reedSolomonMultiply(result[j],root);
        if(j+1<result.length)result[j]^=result[j+1];
      }
      root=reedSolomonMultiply(root,2);
    }
    return result;
  }
  function reedSolomonComputeRemainder(data,divisor){
    var result=[];for(var i=0;i<divisor.length;i++)result.push(0);
    for(var i=0;i<data.length;i++){
      var factor=data[i]^result.shift();result.push(0);
      for(var j=0;j<result.length;j++){
        result[j]^=reedSolomonMultiply(divisor[j],factor);
      }
    }
    return result;
  }
  function reedSolomonMultiply(x,y){
    var z=0;
    for(var i=7;i>=0;i--){
      z=(z<<1)^((z>>>7)*0x11D);
      z^=((y>>>i)&1)*x;
    }
    return z;
  }

  function getAlignmentPatternPositions(ver){
    if(ver==1)return[];
    var numAlign=Math.floor(ver/7)+2;
    var step=(ver==32)?26:(Math.ceil((4*ver+4)/(2*numAlign-2))*2);
    var result=[6];for(var pos=ver*4+10;result.length<numAlign;pos-=step)result.splice(1,0,pos);
    return result;
  }

  QR.encode=function(text){
    var data=[];
    for(var i=0;i<text.length;i++){
      var c=text.charCodeAt(i);
      if(c<0x80)data.push(c);
      else if(c<0x800){data.push(0xC0|(c>>6));data.push(0x80|(c&0x3F));}
      else{data.push(0xE0|(c>>12));data.push(0x80|((c>>6)&0x3F));data.push(0x80|(c&0x3F));}
    }
    // Find minimum version
    var version=1;
    for(;version<=40;version++){
      var cap=getNumDataCodewords(version)*8-4-((version>=10)?16:8);
      if(data.length*8<=cap)break;
    }
    if(version>40)throw new Error('Data too long');
    var dataCapacity=getNumDataCodewords(version);

    // Build bit stream: mode(4) + count(8or16) + data + terminator + padding
    var bb=[];
    function appendBits(val,len){for(var i=len-1;i>=0;i--)bb.push((val>>>i)&1);}
    appendBits(4,4); // Byte mode
    appendBits(data.length,version>=10?16:8);
    for(var i=0;i<data.length;i++)appendBits(data[i],8);
    appendBits(0,Math.min(4,dataCapacity*8-bb.length));
    while(bb.length%8!==0)bb.push(0);
    for(var pad=0xEC;bb.length<dataCapacity*8;pad^=0xEC^0x11)appendBits(pad,8);

    // Convert bits to bytes
    var dataBytes=[];
    for(var i=0;i<bb.length;i+=8)dataBytes.push((bb[i]<<7)|(bb[i+1]<<6)|(bb[i+2]<<5)|(bb[i+3]<<4)|(bb[i+4]<<3)|(bb[i+5]<<2)|(bb[i+6]<<1)|bb[i+7]);

    // ECC
    var numBlocks=NUM_ERROR_CORRECTION_BLOCKS[version];
    var blockEccLen=ECC_CODEWORDS_PER_BLOCK[version];
    var rawCodewords=Math.floor(getNumRawDataModules(version)/8);
    var shortBlockLen=Math.floor(rawCodewords/numBlocks)-blockEccLen;
    var numShortBlocks=numBlocks-Math.floor(rawCodewords%numBlocks===0?0:rawCodewords%numBlocks);
    // Fixed: handle remainder properly
    numShortBlocks=numBlocks-(rawCodewords%numBlocks||numBlocks); if(numShortBlocks<0||numShortBlocks>numBlocks)numShortBlocks=numBlocks-(rawCodewords%numBlocks);
    var rsDiv=reedSolomonComputeDivisor(blockEccLen);
    var blocks=[],eccBlocks=[];
    var idx=0;
    for(var i=0;i<numBlocks;i++){
      var len=shortBlockLen+(i>=numShortBlocks?1:0);
      var block=dataBytes.slice(idx,idx+len);idx+=len;
      blocks.push(block);
      eccBlocks.push(reedSolomonComputeRemainder(block,rsDiv));
    }
    // Interleave
    var result=[];
    for(var i=0;i<shortBlockLen+1;i++){
      for(var j=0;j<numBlocks;j++){if(i===shortBlockLen&&j<numShortBlocks)continue;result.push(blocks[j][i]);}
    }
    for(var i=0;i<blockEccLen;i++){for(var j=0;j<numBlocks;j++)result.push(eccBlocks[j][i]);}

    // Place modules
    var size=version*4+17;
    var modules=[];for(var y=0;y<size;y++){modules[y]=[];for(var x=0;x<size;x++)modules[y][x]=0;}
    var isFunc=[];for(var y=0;y<size;y++){isFunc[y]=[];for(var x=0;x<size;x++)isFunc[y][x]=false;}

    function setModule(x,y,dark){modules[y][x]=dark?1:0;isFunc[y][x]=true;}
    // Finder patterns
    function drawFinder(cx,cy){
      for(var dy=-4;dy<=4;dy++)for(var dx=-4;dx<=4;dx++){
        var x=cx+dx,y=cy+dy;
        if(x>=0&&x<size&&y>=0&&y<size){
          var dist=Math.max(Math.abs(dx),Math.abs(dy));
          setModule(x,y,dist!==4&&(dist!==2&&dist!==3||dist===0||dist===1));
        }
      }
    }
    drawFinder(3,3);drawFinder(size-4,3);drawFinder(3,size-4);
    // Alignment patterns
    var alignPos=getAlignmentPatternPositions(version);
    for(var i=0;i<alignPos.length;i++)for(var j=0;j<alignPos.length;j++){
      if((i===0&&j===0)||(i===0&&j===alignPos.length-1)||(i===alignPos.length-1&&j===0))continue;
      for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++)
        setModule(alignPos[j]+dx,alignPos[i]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
    // Timing patterns
    for(var i=8;i<size-8;i++){setModule(i,6,i%2===0);setModule(6,i,i%2===0);}
    // Dark module
    setModule(8,size-8,true);
    // Reserve format bits
    for(var i=0;i<9;i++){if(!isFunc[i])setModule(8,i,false);if(!isFunc[8])setModule(i,8,false);}
    for(var i=0;i<8;i++){setModule(size-1-i,8,false);setModule(8,size-1-i,false);}
    // Reserve version info
    if(version>=7){for(var i=0;i<18;i++){var bit=false;setModule(size-11+i%3,Math.floor(i/3),bit);setModule(Math.floor(i/3),size-11+i%3,bit);}}

    // Place data bits
    var bitIdx=0;
    for(var right=size-1;right>=1;right-=2){
      if(right===6)right=5;
      for(var vert=0;vert<size;vert++){
        for(var j=0;j<2;j++){
          var x=right-j;
          var upward=((right+1)&2)===0;
          var y=upward?size-1-vert:vert;
          if(!isFunc[y][x]&&bitIdx<result.length*8){
            modules[y][x]=(result[bitIdx>>>3]>>>(7-(bitIdx&7)))&1;
            bitIdx++;
          }
        }
      }
    }

    // Masking (use mask 0 for simplicity)
    var mask=0;
    for(var y=0;y<size;y++)for(var x=0;x<size;x++){
      if(!isFunc[y][x]){
        var invert=false;
        if(mask===0)invert=(x+y)%2===0;
        if(invert)modules[y][x]^=1;
      }
    }

    // Format bits (ECC L = 01, mask 0 = 000 → format = 0b01000 = 8)
    var formatBits=0;var rem=8<<10;
    for(var i=14;i>=10;i--){if((rem>>>(i))&1)rem^=0x537<<(i-10);}
    formatBits=(8<<10|rem)^0x5412;
    for(var i=0;i<=5;i++)modules[8][i]=isFunc[8][i]?modules[8][i]:((formatBits>>i)&1);
    modules[8][7]=isFunc[8][7]?modules[8][7]:((formatBits>>6)&1);
    modules[8][8]=isFunc[8][8]?modules[8][8]:((formatBits>>7)&1);
    modules[7][8]=isFunc[7][8]?modules[7][8]:((formatBits>>8)&1);
    for(var i=9;i<15;i++)modules[14-i][8]=isFunc[14-i]&&isFunc[14-i][8]?modules[14-i][8]:((formatBits>>i)&1);
    for(var i=0;i<8;i++)modules[size-1-i][8]=((formatBits>>i)&1);
    for(var i=8;i<15;i++)modules[8][size-15+i]=((formatBits>>i)&1);

    // Version info bits
    if(version>=7){
      var rem2=version;for(var i=0;i<12;i++)rem2=(rem2<<1)^((rem2>>>11)*0x1F25);
      var vBits=version<<12|rem2;
      for(var i=0;i<18;i++){
        var bit=(vBits>>>i)&1;
        modules[Math.floor(i/3)][size-11+i%3]=bit;
        modules[size-11+i%3][Math.floor(i/3)]=bit;
      }
    }

    return {modules:modules,size:size};
  };

  // Render to canvas
  var text='${escaped}';
  try{
    var qr=QR.encode(text);
    var canvas=document.getElementById('qr');
    var ctx=canvas.getContext('2d');
    var cellSize=Math.floor(200/qr.size);
    var offset=Math.floor((200-cellSize*qr.size)/2);
    canvas.width=200;canvas.height=200;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,200,200);
    ctx.fillStyle='#000';
    for(var y=0;y<qr.size;y++)for(var x=0;x<qr.size;x++){
      if(qr.modules[y][x])ctx.fillRect(offset+x*cellSize,offset+y*cellSize,cellSize,cellSize);
    }
    document.getElementById('info').textContent=text.length+' bytes · Ed25519 signed';
  }catch(e){
    document.getElementById('info').textContent='QR Error: '+e.message+'\\n'+text.substring(0,60)+'…';
  }
})();
</script>
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
  const [nearbyUsers, setNearbyUsers] = useState<
    { id: string; label: string }[]
  >([]);

  // Form state
  const [label, setLabel] = useState('');
  const [cargoDesc, setCargoDesc] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([getDeliveries(), getReceipts()]);
    setDeliveries(d);
    setReceipts(r);
  }, []);

  useEffect(() => {
    load();
    // Load other registered users as potential nearby recipients
    getAllUsers().then(users => {
      const others = users
        .filter(u => u.userId !== user.userId)
        .map(u => ({
          id: u.userId,
          label: `${u.displayName} (${u.primaryRole})`,
        }));
      setNearbyUsers(others);
      if (others.length > 0 && !selectedRecipient) {
        setSelectedRecipient(others[0]!.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, user.userId]);

  const handleGenerate = async () => {
    if (!label.trim()) {
      Alert.alert('Missing Label', 'Enter a delivery label.');
      return;
    }
    if (!selectedRecipient) {
      Alert.alert('No Recipient', 'No other users are registered yet.');
      return;
    }
    setLoading(true);
    setVerifyResult(null);
    try {
      const delivery = await createSignedDelivery(user, {
        label: label.trim(),
        cargoDescription: cargoDesc.trim() || label.trim(),
        recipientId: selectedRecipient,
      });
      setLabel('');
      setCargoDesc('');
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

      {/* Create Delivery Form */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Create Signed Delivery (M5.1)</Text>
        <TextInput
          style={styles.input}
          placeholder="Delivery label (e.g. Medical Supplies)"
          placeholderTextColor="#9da3b0"
          value={label}
          onChangeText={setLabel}
        />
        <TextInput
          style={styles.input}
          placeholder="Cargo description"
          placeholderTextColor="#9da3b0"
          value={cargoDesc}
          onChangeText={setCargoDesc}
        />
        <Text style={styles.inputLabel}>Recipient (nearby user)</Text>
        {nearbyUsers.length === 0 ? (
          <Text style={styles.emptyHint}>
            No other users registered on this device.
          </Text>
        ) : (
          <View style={styles.nodeRow}>
            {nearbyUsers.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.nodeChip,
                  selectedRecipient === r.id && styles.nodeChipActive,
                ]}
                onPress={() => setSelectedRecipient(r.id)}
              >
                <Text
                  style={[
                    styles.nodeChipText,
                    selectedRecipient === r.id && styles.nodeChipTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity
          style={[styles.genBtn, loading && styles.disabled]}
          disabled={loading || !label.trim()}
          onPress={handleGenerate}
        >
          <Text style={styles.genBtnText}>
            {loading ? 'Signing…' : '🔏 Sign & Generate QR'}
          </Text>
        </TouchableOpacity>
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
                  recipient_id: d.recipientId ?? '',
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
            <Text style={styles.cardMeta}>→ {d.recipientId ?? 'unknown'}</Text>
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
  container: { flex: 1 },
  section: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  sectionTitle: {
    color: '#0058be',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genBtn: {
    backgroundColor: '#e8eaff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  genBtnText: { color: '#131b2e', fontSize: 11, fontWeight: '600' },
  actionBtn: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 6,
  },
  verifyBtn: { backgroundColor: '#0058be' },
  replayBtn: { backgroundColor: '#93000a' },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  resultBadge: {
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f2f3ff',
  },
  resultOk: { backgroundColor: '#d4edda' },
  resultFail: { backgroundColor: '#fce4ec' },
  resultBlock: { backgroundColor: '#f3e5f5' },
  resultText: { color: '#131b2e', fontSize: 12, fontWeight: '700' },
  listScroll: { flex: 1 },
  card: {
    backgroundColor: '#f2f3ff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  receiptCard: { borderColor: '#9da3b0', borderStyle: 'dashed' },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: { color: '#131b2e', fontSize: 13, fontWeight: '700', flex: 1 },
  cardMeta: { color: '#565e74', fontSize: 10, marginBottom: 1 },
  cardHash: { color: '#9da3b0', fontSize: 9, fontFamily: 'monospace' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  tapHint: { color: '#0058be', fontSize: 10, marginTop: 4 },
  bottomPad: { height: 24 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: 280,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  modalTitle: {
    color: '#0058be',
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
    color: '#565e74',
    fontSize: 10,
    marginBottom: 12,
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: '#e8eaff',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  closeBtnText: { color: '#131b2e', fontWeight: '700' },
  // Form styles
  input: {
    backgroundColor: '#f2f3ff',
    color: '#131b2e',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#c2c6d6',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    marginBottom: 8,
  },
  inputLabel: {
    color: '#565e74',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 2,
  },
  nodeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  nodeChip: {
    backgroundColor: '#f2f3ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#c2c6d6',
  },
  nodeChipActive: {
    borderColor: '#0058be',
    backgroundColor: '#e0ecff',
  },
  nodeChipText: { color: '#565e74', fontSize: 10 },
  nodeChipTextActive: { color: '#0058be', fontWeight: '700' },
  emptyHint: {
    color: '#9da3b0',
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 8,
  },
});
