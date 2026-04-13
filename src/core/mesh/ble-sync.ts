/**
 * M2.4 – BLE Delta-Sync Transport
 *
 * Uses react-native-ble-plx (Central role) to discover nearby DigitalDelta
 * peers and exchange Protobuf-encoded SyncDelta payloads.
 *
 * Architecture:
 *   • This device acts as BLE Central: scans for peers advertising the
 *     DIGITAL_DELTA_SERVICE_UUID service.
 *   • The peer (peripheral/server) exposes two GATT characteristics:
 *       – CLOCK_CHAR_UUID  (read)    : peer's current vector clock JSON
 *       – DELTA_CHAR_UUID  (write)   : receives our SyncDelta bytes
 *       – NOTIFY_CHAR_UUID (notify)  : peer pushes its SyncDelta to us
 *   • Each SyncDelta is a Protobuf-encoded message that MUST be ≤ 10 KB;
 *     larger deltas are split across multiple BLE write operations (chunked).
 *   • Peripheral-side GATT server support requires native code; a stub is
 *     provided below. In a full deployment, a React Native Native Module or
 *     react-native-ble-peripheral would host the GATT server.
 *
 * Protobuf encoding uses protobufjs with inline type definitions so we need
 * no separate compilation step (.proto → .js).
 */

import {
  BleManager,
  type Device,
  type Subscription,
} from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { getBlePeripheral } from './ble-peripheral';
import {
  type MeshPacketWireType,
  hasMeshMagic,
  decodeMeshBundle,
  encodeMeshBundle,
  meshMessageToWire,
  wireToMeshMessage,
  applyRelayHop,
  x25519PubHexFromSeed,
} from './engine';

// ── Base64 helpers (Hermes-safe, no Buffer) ───────────────────────────────
// React Native's Hermes engine does not have Node's Buffer global.
// btoa/atob are available as Web API globals on Hermes.

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToString(b64: string): string {
  return atob(b64);
}

// ── Constants ────────────────────────────────────────────────────────────

/** Custom 128-bit service UUID that identifies DigitalDelta BLE peers. */
export const DIGITAL_DELTA_SERVICE_UUID =
  '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';

/** Characteristic: peer exposes its current VectorClock as JSON (read). */
export const CLOCK_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

/** Characteristic: we write our SyncDelta protobuf bytes here (write). */
export const DELTA_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/** Characteristic: peer notifies us with its SyncDelta bytes. */
export const NOTIFY_CHAR_UUID = '6E400004-B5A3-F393-E0A9-E50E24DCCA9E';

/** Maximum bytes per sync exchange (M2.4 requirement). */
const MAX_SYNC_BYTES = 10_240; // 10 KB

/**
 * Fallback BLE write chunk size if MTU negotiation fails.
 * Default BLE ATT MTU = 23. Usable payload = 23 - 3 = 20 bytes.
 * We use 20 as the safe conservative default.
 */
const DEFAULT_CHUNK_SIZE = 20;

/** How long to scan for peers before giving up (ms). */
const SCAN_TIMEOUT_MS = 8_000;

// ── Protobuf schema (inline) ──────────────────────────────────────────────
// We define the wire format inline using protobufjs so we don't need protoc.

const SYNC_PROTO_SCHEMA = `
syntax = "proto3";
package digitaldelta.v1;

message VectorClock {
  map<string, uint64> entries = 1;
}

message SyncCursor {
  VectorClock last_known_clock = 1;
  string      last_event_id    = 2;
}

message SyncItemDelta {
  string item_id          = 1;
  string item_name        = 2;
  string category         = 3;
  uint32 quantity         = 4;
  string unit             = 5;
  VectorClock vector_clock = 6;
  uint64 updated_at_ms    = 7;
}

message SyncDelta {
  SyncCursor         from_cursor     = 1;
  SyncCursor         to_cursor       = 2;
  repeated SyncItemDelta events       = 3;
  uint32             estimated_bytes  = 4;
}
`;

// ── Type definitions mirroring the proto ─────────────────────────────────

export type ProtoVectorClock = { entries: Record<string, number> };

export type ProtoSyncCursor = {
  lastKnownClock: ProtoVectorClock;
  lastEventId: string;
};

export type ProtoSyncItemDelta = {
  itemId: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  vectorClock: ProtoVectorClock;
  updatedAtMs: number;
};

export type ProtoSyncDelta = {
  fromCursor: ProtoSyncCursor;
  toCursor: ProtoSyncCursor;
  events: ProtoSyncItemDelta[];
  estimatedBytes: number;
};

// ── Protobuf encode/decode via protobufjs ─────────────────────────────────

let _pbRoot: unknown = null;

async function getPbRoot(): Promise<unknown> {
  if (_pbRoot) {
    return _pbRoot;
  }
  // protobufjs parse is dynamically loaded to avoid bundling issues
  const protobuf = await import('protobufjs');
  _pbRoot = await (protobuf.default ?? protobuf).parse(SYNC_PROTO_SCHEMA).root;
  return _pbRoot;
}

export async function encodeSyncDelta(
  delta: ProtoSyncDelta,
): Promise<Uint8Array> {
  const root = (await getPbRoot()) as {
    lookupType: (name: string) => {
      encode: (msg: unknown) => { finish: () => Uint8Array };
    };
  };
  const SyncDeltaType = root.lookupType('digitaldelta.v1.SyncDelta');
  return SyncDeltaType.encode(delta).finish();
}

export async function decodeSyncDelta(
  bytes: Uint8Array,
): Promise<ProtoSyncDelta> {
  const root = (await getPbRoot()) as {
    lookupType: (name: string) => {
      decode: (bytes: Uint8Array) => ProtoSyncDelta;
    };
  };
  const SyncDeltaType = root.lookupType('digitaldelta.v1.SyncDelta');
  return SyncDeltaType.decode(bytes) as ProtoSyncDelta;
}

// ── Permission helpers ────────────────────────────────────────────────────

async function requestBlePermissionsAndroid(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const apiLevel = Platform.Version as number;

  if (apiLevel >= 31) {
    // Android 12+ uses granular BLE permissions
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(granted).every(
      s => s === PermissionsAndroid.RESULTS.GRANTED,
    );
  }

  // Android 6-11: classic permissions
  const loc = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return loc === PermissionsAndroid.RESULTS.GRANTED;
}

// ── BleSync class ─────────────────────────────────────────────────────────

type SyncPeerResult = {
  remoteDeviceId: string;
  localWins: number;
  remoteWins: number;
  conflicts: number;
  newItems: number;
};

export class BleSyncService {
  private readonly ble: BleManager;
  private scanSub: Subscription | null = null;
  private peripheralStarted = false;
  private peripheralUnsubDelta: (() => void) | null = null;

  constructor() {
    this.ble = new BleManager();
  }

  /**
   * Start advertising this device as a DigitalDelta BLE Peripheral.
   * Inbound deltas from remote Centrals are applied automatically via CRDT.
   * @param vectorClockJson  Our current vector clock to expose to scanners.
   */
  async startPeripheralMode(vectorClockJson: string): Promise<void> {
    const peripheral = getBlePeripheral();
    if (!peripheral.isSupported || this.peripheralStarted) return;

    // BLUETOOTH_CONNECT + BLUETOOTH_ADVERTISE are runtime permissions on Android 12+
    const hasPerms = await requestBlePermissionsAndroid();
    if (!hasPerms) {
      throw new Error(
        'Bluetooth permissions denied. Grant "Nearby devices" permission in Settings → Apps → DigitalDelta → Permissions.',
      );
    }

    await peripheral.startServer(vectorClockJson);
    this.peripheralStarted = true;

    // When a Central writes data to us, dispatch by type
    this.peripheralUnsubDelta = peripheral.onDeltaReceived(
      async (base64: string, deviceAddress: string) => {
        try {
          const bytes = base64ToBytes(base64);

          // Mesh relay bundle (MESH magic prefix) — M3.1 store-and-forward
          if (hasMeshMagic(bytes)) {
            await this._handleIncomingMeshBundle(bytes, deviceAddress);
            return;
          }

          // CRDT sync delta (M2.4) — existing behavior
          const peerDelta = await decodeSyncDelta(bytes);
          await this._applyReceivedDelta(peerDelta, deviceAddress);

          // Respond: build our own delta and notify the Central back
          const built = await this.buildLocalDelta([]);
          if (built) {
            const responseB64 = bytesToBase64(built.bytes);
            await peripheral.sendDelta(responseB64);
          }

          // Keep the clock char up to date after applying remote changes
          const { getInventory } = await import('../../api/inventory');
          const items = await getInventory();
          const merged: Record<string, number> = {};
          for (const item of items) {
            for (const [actor, counter] of Object.entries(item.vectorClock)) {
              merged[actor] = Math.max(merged[actor] ?? 0, counter as number);
            }
          }
          await peripheral.updateVectorClock(JSON.stringify(merged));
        } catch (err) {
          // Non-fatal: log and continue advertising
          console.warn('[BlePeripheral] failed to apply inbound delta', err);
        }
      },
    );
  }

  /** Stop advertising and tear down the GATT server. */
  async stopPeripheralMode(): Promise<void> {
    if (!this.peripheralStarted) return;
    this.peripheralUnsubDelta?.();
    this.peripheralUnsubDelta = null;
    await getBlePeripheral().stopServer();
    this.peripheralStarted = false;
  }

  /** Scan for a DigitalDelta peer, connect, and exchange a SyncDelta.
   *
   * IMPORTANT: Do NOT start peripheral mode here. If this device is also
   * advertising the same service UUID while scanning, Android's BLE stack
   * deduplicates and suppresses advertisements from the peer device.
   * Peripheral mode must be started explicitly by the user on the other device.
   */
  async syncWithNearbyPeer(): Promise<SyncPeerResult | null> {
    const hasPerms = await requestBlePermissionsAndroid();
    if (!hasPerms) {
      throw new Error(
        'Bluetooth permissions denied. Grant "Nearby devices" permission in Settings → Apps → DigitalDelta → Permissions.',
      );
    }

    const peer = await this._discoverPeer();
    if (!peer) {
      return null;
    }

    try {
      return await this._exchangeDeltaWith(peer);
    } finally {
      try {
        await peer.cancelConnection();
      } catch {
        // best-effort disconnect
      }
    }
  }

  /** Compute a SyncDelta from up-to-date local inventory relative to cursor. */
  async buildLocalDelta(
    lastKnownItems: ProtoSyncItemDelta[],
  ): Promise<{ delta: ProtoSyncDelta; bytes: Uint8Array } | null> {
    // Import inventory lazily to avoid circular dependency
    const { getInventory } = await import('../../api/inventory');
    const items = await getInventory();

    const knownByItemId = new Map(
      lastKnownItems.map(i => [i.itemId, i] as [string, ProtoSyncItemDelta]),
    );

    const deltas: ProtoSyncItemDelta[] = [];
    const globalClock: Record<string, number> = {};

    for (const item of items) {
      // Track the global merged clock
      for (const [actor, counter] of Object.entries(item.vectorClock)) {
        globalClock[actor] = Math.max(globalClock[actor] ?? 0, counter);
      }

      // Only include items that differ from what the peer last knew
      const known = knownByItemId.get(item.itemId);
      const hasChanged =
        !known ||
        known.quantity !== item.quantity ||
        JSON.stringify(known.vectorClock.entries) !==
          JSON.stringify(item.vectorClock);

      if (hasChanged) {
        deltas.push({
          itemId: item.itemId,
          itemName: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          vectorClock: { entries: item.vectorClock as Record<string, number> },
          updatedAtMs: item.updatedAtMs,
        });
      }
    }

    const delta: ProtoSyncDelta = {
      fromCursor: {
        lastKnownClock: { entries: {} },
        lastEventId: '',
      },
      toCursor: {
        lastKnownClock: { entries: globalClock },
        lastEventId: '',
      },
      events: deltas,
      estimatedBytes: 0,
    };

    let bytes = await encodeSyncDelta(delta);

    // Enforce 10 KB limit by dropping oldest items until we fit
    while (bytes.length > MAX_SYNC_BYTES && delta.events.length > 0) {
      delta.events.shift();
      bytes = await encodeSyncDelta(delta);
    }

    if (bytes.length === 0) {
      return null;
    }

    delta.estimatedBytes = bytes.length;
    return { delta, bytes };
  }

  destroy(): void {
    this.scanSub?.remove();
    void this.stopPeripheralMode();
    this.ble.destroy();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _discoverPeer(): Promise<Device | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.scanSub?.remove();
        this.ble.stopDeviceScan();
        resolve(null); // no peer found within timeout
      }, SCAN_TIMEOUT_MS);

      this.scanSub = this.ble.onStateChange(state => {
        if (state === 'PoweredOn') {
          this.scanSub?.remove();
          // Scan all devices (no UUID filter) – Android UUID filters are
          // unreliable when the device is also running a GATT server or when
          // the peripheral uses a 128-bit UUID with some BLE chipsets.
          // We manually check serviceUUIDs on each discovered device.
          this.ble.startDeviceScan(
            null,
            { allowDuplicates: false },
            (error, device) => {
              if (error) {
                clearTimeout(timer);
                this.ble.stopDeviceScan();
                reject(new Error(`BLE scan error: ${error.message}`));
                return;
              }
              if (device) {
                const uuids = device.serviceUUIDs ?? [];
                const hasService = uuids.some(
                  u =>
                    u.toLowerCase() ===
                    DIGITAL_DELTA_SERVICE_UUID.toLowerCase(),
                );
                if (hasService) {
                  clearTimeout(timer);
                  this.ble.stopDeviceScan();
                  resolve(device);
                }
              }
            },
          );
        } else if (state === 'PoweredOff' || state === 'Unsupported') {
          clearTimeout(timer);
          this.scanSub?.remove();
          reject(
            new Error('Bluetooth is off or not supported on this device.'),
          );
        }
      }, true);
    });
  }

  private async _exchangeDeltaWith(
    device: Device,
  ): Promise<SyncPeerResult | null> {
    const connected = await device.connect({ autoConnect: false });
    const discovered = await connected.discoverAllServicesAndCharacteristics();

    // Negotiate a larger MTU — default is 23 (20 usable), which is too
    // small for our protobuf chunks. Android supports up to 517.
    let chunkSize = DEFAULT_CHUNK_SIZE;
    try {
      const mtuDevice = await discovered.requestMTU(517);
      chunkSize = Math.max(20, (mtuDevice.mtu ?? 23) - 3);
    } catch {
      // MTU negotiation failed — use conservative default
      chunkSize = DEFAULT_CHUNK_SIZE;
    }

    // Read peer's current vector clock from CLOCK_CHAR_UUID
    const clockChar = await discovered.readCharacteristicForService(
      DIGITAL_DELTA_SERVICE_UUID,
      CLOCK_CHAR_UUID,
    );
    const peerClockJson = clockChar.value
      ? base64ToString(clockChar.value)
      : '{}';

    let peerClock: Record<string, number> = {};
    try {
      peerClock = JSON.parse(peerClockJson) as Record<string, number>;
    } catch {
      peerClock = {};
    }

    // Build our delta relative to peer's clock
    const peerItems: ProtoSyncItemDelta[] = Object.entries(peerClock).map(
      ([id]) => ({
        itemId: id,
        itemName: '',
        category: '',
        quantity: 0,
        unit: '',
        vectorClock: { entries: peerClock },
        updatedAtMs: 0,
      }),
    );

    const built = await this.buildLocalDelta(peerItems);
    if (!built) {
      return null;
    }

    // Write our SyncDelta to peer: chunk across multiple writes
    const chunks = this._chunkBytes(built.bytes, chunkSize);
    for (const chunk of chunks) {
      const b64 = bytesToBase64(chunk);
      await discovered.writeCharacteristicWithoutResponseForService(
        DIGITAL_DELTA_SERVICE_UUID,
        DELTA_CHAR_UUID,
        b64,
      );
    }
    // Signal end-of-transmission with an empty write
    await discovered.writeCharacteristicWithoutResponseForService(
      DIGITAL_DELTA_SERVICE_UUID,
      DELTA_CHAR_UUID,
      btoa(''),
    );

    // Read peer's delta from NOTIFY_CHAR_UUID (single read after write)
    const notifyChar = await discovered.readCharacteristicForService(
      DIGITAL_DELTA_SERVICE_UUID,
      NOTIFY_CHAR_UUID,
    );

    let appliedConflicts = 0;
    let appliedRemoteWins = 0;
    let appliedLocalWins = 0;

    if (notifyChar.value) {
      const peerDeltaBytes = base64ToBytes(notifyChar.value);
      const peerDelta = await decodeSyncDelta(new Uint8Array(peerDeltaBytes));
      const applyResult = await this._applyReceivedDelta(peerDelta, device.id);
      appliedConflicts = applyResult.conflicts;
      appliedRemoteWins = applyResult.remoteWins;
      appliedLocalWins = applyResult.localWins;
    }

    return {
      remoteDeviceId: device.id,
      localWins: appliedLocalWins,
      remoteWins: appliedRemoteWins,
      conflicts: appliedConflicts,
      newItems: 0,
    };
  }

  /** Apply received SyncDelta events using existing CRDT merge logic. */
  private async _applyReceivedDelta(
    delta: ProtoSyncDelta,
    remoteDeviceId: string,
  ): Promise<{ localWins: number; remoteWins: number; conflicts: number }> {
    // Lazy import to avoid circular dependency in DI graph
    const { getDatabase } = await import('../../db');
    const { mergeItem } = await import('../crdt/inventory');
    const db = await getDatabase();

    const { getInventory } = await import('../../api/inventory');
    const localItems = await getInventory();
    const localMap = new Map(localItems.map(i => [i.itemId, i]));

    let localWins = 0;
    let remoteWins = 0;
    let conflicts = 0;

    for (const event of delta.events) {
      const localItem = localMap.get(event.itemId);
      const remoteClock = event.vectorClock.entries as Record<string, number>;

      if (!localItem) {
        // New item from remote → insert
        const nowMs = Date.now();
        await db.execute(
          `INSERT OR IGNORE INTO supply_inventory
           (inventory_item_id, sku, item_name, category, quantity, unit,
            storage_node_id, status, vector_clock_json, updated_at_ms, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, '{}')`,
          [
            event.itemId,
            event.itemId,
            event.itemName,
            event.category,
            event.quantity,
            event.unit,
            remoteDeviceId,
            JSON.stringify(remoteClock),
            nowMs,
          ],
        );
        continue;
      }

      const { bytesToHex, randomBytes } = await import('../auth/crypto');
      const genLocalId = (p: string) =>
        `${p}${bytesToHex(randomBytes(4)).toUpperCase()}`;
      const conflictId = genLocalId('CONF-');

      const remoteVersion = {
        ...localItem,
        quantity: event.quantity,
        vectorClock: remoteClock,
        updatedAtMs: event.updatedAtMs,
      };

      const result = mergeItem(
        localItem,
        remoteVersion,
        conflictId,
        remoteDeviceId,
      );

      if (result.outcome === 'conflict') {
        const { serializeVectorClock } = await import('../crdt/vectorClock');
        await db.execute(
          `INSERT INTO crdt_conflicts
           (conflict_id, item_id, item_name, local_quantity, remote_quantity,
            local_clock_json, remote_clock_json, remote_device_id, detected_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            result.conflict.conflictId,
            result.conflict.itemId,
            result.conflict.itemName,
            result.conflict.localQuantity,
            result.conflict.remoteQuantity,
            serializeVectorClock(result.conflict.localClock),
            serializeVectorClock(result.conflict.remoteClock),
            remoteDeviceId,
            result.conflict.detectedAtMs,
          ],
        );
        conflicts++;
      } else if (result.outcome === 'remote_wins') {
        const { serializeVectorClock } = await import('../crdt/vectorClock');
        const u = result.item;
        await db.execute(
          `UPDATE supply_inventory
           SET quantity = ?, vector_clock_json = ?, updated_at_ms = ?
           WHERE inventory_item_id = ?`,
          [
            u.quantity,
            serializeVectorClock(u.vectorClock),
            u.updatedAtMs,
            localItem.itemId,
          ],
        );
        remoteWins++;
      } else {
        localWins++;
      }
    }

    return { localWins, remoteWins, conflicts };
  }

  // ── M3.1 Mesh Relay via BLE ──────────────────────────────────────────

  /**
   * Scan for a BLE peer and exchange mesh message queues (store-and-forward).
   * Uses Protobuf-encoded MeshBundle over the same GATT characteristics.
   */
  async relayMeshToPeer(): Promise<{
    relayed: number;
    received: number;
    peerId: string;
  } | null> {
    const hasPerms = await requestBlePermissionsAndroid();
    if (!hasPerms) {
      throw new Error(
        'Bluetooth permissions denied. Grant "Nearby devices" permission.',
      );
    }

    const peer = await this._discoverPeer();
    if (!peer) return null;

    try {
      return await this._exchangeMeshWith(peer);
    } finally {
      try {
        await peer.cancelConnection();
      } catch {
        // best-effort disconnect
      }
    }
  }

  /** Handle incoming mesh bundle from a Central (peripheral side). */
  private async _handleIncomingMeshBundle(
    bytes: Uint8Array,
    deviceAddress: string,
  ): Promise<void> {
    const bundle = await decodeMeshBundle(bytes);

    // Import lazily to avoid circular deps
    const { getDeviceIdentity, getLocalDeviceSeed } = await import(
      '../../api/auth'
    );
    const {
      receiveRelayedMessages,
      getForwardableMessages,
      getCurrentRole,
      saveMeshPeer,
    } = await import('../../api/mesh');
    const { bytesToHex, hexToBytes } = await import('../auth/crypto');

    const identity = await getDeviceIdentity();
    const deviceId = identity?.deviceId ?? '';
    const seed = deviceId ? await getLocalDeviceSeed(deviceId) : null;

    // Save peer's public key if included in bundle
    if (bundle.relayNodeId && bundle.relayNodeX25519Pub) {
      const pubBytes =
        bundle.relayNodeX25519Pub instanceof Uint8Array
          ? bundle.relayNodeX25519Pub
          : new Uint8Array(bundle.relayNodeX25519Pub as ArrayBuffer);
      if (pubBytes.length > 0) {
        await saveMeshPeer(bundle.relayNodeId, bytesToHex(pubBytes));
      }
    }

    // Store incoming packets (auto-delivers if destined for us)
    const peerMessages = (bundle.packets || []).map(p =>
      wireToMeshMessage(p as MeshPacketWireType),
    );
    await receiveRelayedMessages(peerMessages, deviceId, seed ?? undefined);

    // Respond with our own mesh queue for the peer to forward
    const myMessages = await getForwardableMessages(deviceId);
    const roleEntry = await getCurrentRole(deviceId);
    const role = roleEntry?.role ?? 'relay';

    const wirePackets: MeshPacketWireType[] = [];
    for (const msg of myMessages) {
      if (msg.originDeviceId !== deviceId) {
        const hopped = applyRelayHop(msg, deviceId);
        if (!hopped) continue;
        wirePackets.push(meshMessageToWire(hopped, role));
      } else {
        wirePackets.push(meshMessageToWire(msg, role));
      }
    }

    if (wirePackets.length > 0 || seed) {
      const responseBundle = {
        packets: wirePackets,
        relayNodeId: deviceId,
        relayNodeRole: role,
        timestampMs: Date.now(),
        relayNodeX25519Pub: seed
          ? hexToBytes(x25519PubHexFromSeed(seed))
          : undefined,
      };
      const responseBytes = await encodeMeshBundle(responseBundle);
      const peripheral = getBlePeripheral();
      await peripheral.sendDelta(bytesToBase64(responseBytes));
    }
  }

  /** Central-side: connect to peer GATT server and exchange mesh bundles. */
  private async _exchangeMeshWith(
    device: Device,
  ): Promise<{ relayed: number; received: number; peerId: string }> {
    const connected = await device.connect({ autoConnect: false });
    const discovered = await connected.discoverAllServicesAndCharacteristics();

    // Negotiate MTU
    let chunkSize = DEFAULT_CHUNK_SIZE;
    try {
      const mtuDevice = await discovered.requestMTU(517);
      chunkSize = Math.max(20, (mtuDevice.mtu ?? 23) - 3);
    } catch {
      chunkSize = DEFAULT_CHUNK_SIZE;
    }

    // Get local identity and role
    const { getDeviceIdentity, getLocalDeviceSeed } = await import(
      '../../api/auth'
    );
    const {
      getForwardableMessages,
      receiveRelayedMessages,
      markMessagesRelayed,
      getCurrentRole,
      saveMeshPeer,
    } = await import('../../api/mesh');
    const { bytesToHex, hexToBytes } = await import('../auth/crypto');

    const identity = await getDeviceIdentity();
    const deviceId = identity?.deviceId ?? '';
    const seed = deviceId ? await getLocalDeviceSeed(deviceId) : null;
    const roleEntry = await getCurrentRole(deviceId);
    const role = roleEntry?.role ?? 'relay';

    // Build mesh bundle from local queue
    const messages = await getForwardableMessages(deviceId);
    const wirePackets: MeshPacketWireType[] = [];
    for (const msg of messages) {
      if (msg.originDeviceId !== deviceId) {
        const hopped = applyRelayHop(msg, deviceId);
        if (!hopped) continue;
        wirePackets.push(meshMessageToWire(hopped, role));
      } else {
        wirePackets.push(meshMessageToWire(msg, role));
      }
    }

    const bundle = {
      packets: wirePackets,
      relayNodeId: deviceId,
      relayNodeRole: role,
      timestampMs: Date.now(),
      relayNodeX25519Pub: seed
        ? hexToBytes(x25519PubHexFromSeed(seed))
        : undefined,
    };
    const bytes = await encodeMeshBundle(bundle);

    // Write Protobuf mesh bundle to peer GATT server (chunked)
    const chunks = this._chunkBytes(bytes, chunkSize);
    for (const chunk of chunks) {
      const b64 = bytesToBase64(chunk);
      await discovered.writeCharacteristicWithoutResponseForService(
        DIGITAL_DELTA_SERVICE_UUID,
        DELTA_CHAR_UUID,
        b64,
      );
    }
    // End-of-transmission signal
    await discovered.writeCharacteristicWithoutResponseForService(
      DIGITAL_DELTA_SERVICE_UUID,
      DELTA_CHAR_UUID,
      btoa(''),
    );

    // Mark sent messages as relayed
    if (messages.length > 0) {
      await markMessagesRelayed(
        messages.map(m => m.messageId),
        device.id,
      );
    }

    // Read peer's mesh response from NOTIFY characteristic.
    // The peripheral processes our bundle asynchronously, so we poll
    // until the response appears (up to ~4 s).
    let received = 0;
    let resolvedPeerId = device.id;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) {
        await new Promise<void>(r => setTimeout(r, 500));
      }
      try {
        const notifyChar = await discovered.readCharacteristicForService(
          DIGITAL_DELTA_SERVICE_UUID,
          NOTIFY_CHAR_UUID,
        );
        if (!notifyChar.value) continue;
        const peerBytes = base64ToBytes(notifyChar.value);
        if (peerBytes.length <= 4 || !hasMeshMagic(peerBytes)) continue;

        const peerBundle = await decodeMeshBundle(peerBytes);

        // Save peer's public key for future message encryption
        if (peerBundle.relayNodeId && peerBundle.relayNodeX25519Pub) {
          const pubBytes =
            peerBundle.relayNodeX25519Pub instanceof Uint8Array
              ? peerBundle.relayNodeX25519Pub
              : new Uint8Array(peerBundle.relayNodeX25519Pub as ArrayBuffer);
          if (pubBytes.length > 0) {
            await saveMeshPeer(peerBundle.relayNodeId, bytesToHex(pubBytes));
            resolvedPeerId = peerBundle.relayNodeId;
          }
        }

        const peerMessages = (peerBundle.packets || []).map(p =>
          wireToMeshMessage(p as MeshPacketWireType),
        );
        const result = await receiveRelayedMessages(
          peerMessages,
          deviceId,
          seed ?? undefined,
        );
        received = result.stored;
        break; // success — stop polling
      } catch {
        // read failed, retry
      }
    }

    return { relayed: wirePackets.length, received, peerId: resolvedPeerId };
  }

  /** Split a byte array into chunks sized to the negotiated MTU. */
  private _chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += size) {
      chunks.push(bytes.slice(offset, offset + size));
    }
    return chunks;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _bleSyncInstance: BleSyncService | null = null;

export function getBleSyncService(): BleSyncService {
  if (!_bleSyncInstance) {
    _bleSyncInstance = new BleSyncService();
  }
  return _bleSyncInstance;
}

export function destroyBleSyncService(): void {
  _bleSyncInstance?.destroy();
  _bleSyncInstance = null;
}
