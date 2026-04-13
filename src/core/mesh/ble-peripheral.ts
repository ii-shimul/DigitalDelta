/**
 * BlePeripheral – JS wrapper for the BleGattServer NativeModule
 *
 * Abstracts the native Android GATT server so the rest of the codebase works
 * with a clean async/event API rather than raw NativeModules.
 *
 * Usage:
 *   const peripheral = getBlePeripheral();
 *   await peripheral.startServer(myClockJson);
 *   peripheral.onDeltaReceived((base64, deviceAddress) => { ... });
 *   await peripheral.sendDelta(base64DeltaBytes);
 *   await peripheral.stopServer();
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ── Types ──────────────────────────────────────────────────────────────────

export type DeltaReceivedCallback = (
  base64: string,
  deviceAddress: string,
) => void;

export type ClientConnectionCallback = (deviceAddress: string) => void;

interface BleGattServerNativeModule {
  startServer(vectorClockJson: string): Promise<void>;
  stopServer(): Promise<void>;
  updateVectorClock(vectorClockJson: string): Promise<void>;
  sendDelta(base64: string): Promise<void>;
}

// ── BlePeripheral ──────────────────────────────────────────────────────────

export class BlePeripheral {
  private readonly native: BleGattServerNativeModule | null;
  private readonly emitter: NativeEventEmitter | null;

  private deltaListeners: DeltaReceivedCallback[] = [];
  private connectListeners: ClientConnectionCallback[] = [];
  private disconnectListeners: ClientConnectionCallback[] = [];

  constructor() {
    if (Platform.OS !== 'android' || !NativeModules.BleGattServer) {
      this.native = null;
      this.emitter = null;
      return;
    }
    this.native = NativeModules.BleGattServer as BleGattServerNativeModule;
    this.emitter = new NativeEventEmitter(
      // NativeEventEmitter requires NativeModule reference
      NativeModules.BleGattServer,
    );

    // Wire up persistent native event listeners
    this.emitter.addListener(
      'BleGattDeltaReceived',
      (evt: { base64: string; deviceAddress: string }) => {
        this.deltaListeners.forEach(cb => cb(evt.base64, evt.deviceAddress));
      },
    );

    this.emitter.addListener(
      'BleGattClientConnected',
      (evt: { deviceAddress: string }) => {
        this.connectListeners.forEach(cb => cb(evt.deviceAddress));
      },
    );

    this.emitter.addListener(
      'BleGattClientDisconnected',
      (evt: { deviceAddress: string }) => {
        this.disconnectListeners.forEach(cb => cb(evt.deviceAddress));
      },
    );
  }

  /** Returns true when the native module is available (Android only). */
  get isSupported(): boolean {
    return this.native !== null;
  }

  /**
   * Start the GATT server and BLE advertising.
   * @param vectorClockJson  Current local vector clock as a JSON string.
   */
  async startServer(vectorClockJson: string): Promise<void> {
    if (!this.native) {
      return; // silently no-op on unsupported platforms
    }
    await this.native.startServer(vectorClockJson);
  }

  /** Stop advertising and close the GATT server. */
  async stopServer(): Promise<void> {
    if (!this.native) return;
    await this.native.stopServer();
  }

  /**
   * Tell the native layer what clock JSON to return when Centrals read
   * CLOCK_CHAR. Call this after every local mutation.
   */
  async updateVectorClock(vectorClockJson: string): Promise<void> {
    if (!this.native) return;
    await this.native.updateVectorClock(vectorClockJson);
  }

  /**
   * Notify all connected Centrals with our SyncDelta.
   * The delta MUST be ≤ 10 KB (enforced native-side).
   * @param base64  Base64-encoded protobuf SyncDelta bytes.
   */
  async sendDelta(base64: string): Promise<void> {
    if (!this.native) return;
    await this.native.sendDelta(base64);
  }

  /** Subscribe to inbound SyncDelta chunks from any Central. */
  onDeltaReceived(cb: DeltaReceivedCallback): () => void {
    this.deltaListeners.push(cb);
    return () => {
      this.deltaListeners = this.deltaListeners.filter(l => l !== cb);
    };
  }

  /** Subscribe to Central connection events. */
  onClientConnected(cb: ClientConnectionCallback): () => void {
    this.connectListeners.push(cb);
    return () => {
      this.connectListeners = this.connectListeners.filter(l => l !== cb);
    };
  }

  /** Subscribe to Central disconnection events. */
  onClientDisconnected(cb: ClientConnectionCallback): () => void {
    this.disconnectListeners.push(cb);
    return () => {
      this.disconnectListeners = this.disconnectListeners.filter(l => l !== cb);
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _instance: BlePeripheral | null = null;

export function getBlePeripheral(): BlePeripheral {
  if (!_instance) {
    _instance = new BlePeripheral();
  }
  return _instance;
}
