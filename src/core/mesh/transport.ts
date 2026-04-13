import type { SyncTransportKind } from './protocol';

export type ReceivedMeshPacket = {
  transport: SyncTransportKind;
  peerDeviceId: string;
  payload: Uint8Array;
  receivedAtMs: number;
};

export interface MeshTransport {
  readonly kind: SyncTransportKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(peerDeviceId: string, payload: Uint8Array): Promise<void>;
  onPacket(handler: (packet: ReceivedMeshPacket) => void): () => void;
}

export class InMemoryLoopbackTransport implements MeshTransport {
  readonly kind: SyncTransportKind = 'loopback';

  private started = false;

  private readonly handlers = new Set<(packet: ReceivedMeshPacket) => void>();

  constructor(private readonly localDeviceId: string) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.handlers.clear();
  }

  async send(peerDeviceId: string, payload: Uint8Array): Promise<void> {
    if (!this.started) {
      throw new Error('Loopback transport is not started.');
    }

    const packet: ReceivedMeshPacket = {
      transport: 'loopback',
      peerDeviceId,
      payload: new Uint8Array(payload),
      receivedAtMs: Date.now(),
    };

    for (const handler of this.handlers) {
      handler(packet);
    }
  }

  onPacket(handler: (packet: ReceivedMeshPacket) => void): () => void {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }
}

type BleManagerModule = {
  BleManager: new () => {
    startDeviceScan(
      uuids: string[] | null,
      options: Record<string, unknown> | null,
      callback: (error: unknown, scannedDevice: { id?: string; serviceUUIDs?: string[] } | null) => void,
    ): void;
    stopDeviceScan(): void;
    connectToDevice(deviceId: string): Promise<{
      id: string;
      discoverAllServicesAndCharacteristics(): Promise<unknown>;
      writeCharacteristicWithoutResponseForService(
        serviceUUID: string,
        characteristicUUID: string,
        valueBase64: string,
      ): Promise<unknown>;
      monitorCharacteristicForService(
        serviceUUID: string,
        characteristicUUID: string,
        listener: (
          error: unknown,
          characteristic: { value?: string | null; deviceID?: string } | null,
        ) => void,
      ): { remove(): void };
      cancelConnection(): Promise<void>;
    }>;
    destroy(): void;
  };
};

declare const require: undefined | ((moduleName: string) => unknown);

const MESH_SERVICE_UUID = '7b6f6d31-7e0f-4eec-9f4a-b8c45f0ad001';
const MESH_TX_CHARACTERISTIC_UUID = '7b6f6d31-7e0f-4eec-9f4a-b8c45f0ad002';
const MESH_RX_CHARACTERISTIC_UUID = '7b6f6d31-7e0f-4eec-9f4a-b8c45f0ad003';

export class BleMeshTransport implements MeshTransport {
  readonly kind: SyncTransportKind = 'bluetooth_le';

  private readonly handlers = new Set<(packet: ReceivedMeshPacket) => void>();

  private readonly connections = new Map<
    string,
    {
      monitor?: { remove(): void };
      cancelConnection: () => Promise<void>;
    }
  >();

  private manager:
    | InstanceType<NonNullable<BleManagerModule>['BleManager']>
    | undefined;

  async start(): Promise<void> {
    if (this.manager) {
      return;
    }

    const module = loadBleManagerModule();
    if (!module) {
      throw new Error('react-native-ble-plx is unavailable in this runtime.');
    }

    this.manager = new module.BleManager();
  }

  async stop(): Promise<void> {
    if (!this.manager) {
      return;
    }

    this.manager.stopDeviceScan();

    for (const [, connection] of this.connections) {
      connection.monitor?.remove();
      await connection.cancelConnection();
    }
    this.connections.clear();

    this.manager.destroy();
    this.manager = undefined;
  }

  async send(peerDeviceId: string, payload: Uint8Array): Promise<void> {
    const manager = this.ensureManager();

    const connection = await this.getOrConnect(peerDeviceId, manager);

    await manager
      .connectToDevice(peerDeviceId)
      .then(device =>
        device.writeCharacteristicWithoutResponseForService(
          MESH_SERVICE_UUID,
          MESH_TX_CHARACTERISTIC_UUID,
          bytesToBase64(payload),
        ),
      );

    if (!connection.monitor) {
      const connectedDevice = await manager.connectToDevice(peerDeviceId);
      connection.monitor = connectedDevice.monitorCharacteristicForService(
        MESH_SERVICE_UUID,
        MESH_RX_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) {
            return;
          }

          const decoded = base64ToBytes(characteristic.value);
          const packet: ReceivedMeshPacket = {
            transport: 'bluetooth_le',
            peerDeviceId: characteristic.deviceID ?? peerDeviceId,
            payload: decoded,
            receivedAtMs: Date.now(),
          };

          for (const handler of this.handlers) {
            handler(packet);
          }
        },
      );
    }
  }

  onPacket(handler: (packet: ReceivedMeshPacket) => void): () => void {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  private ensureManager(): InstanceType<NonNullable<BleManagerModule>['BleManager']> {
    if (!this.manager) {
      throw new Error('BLE transport has not been started.');
    }

    return this.manager;
  }

  private async getOrConnect(
    peerDeviceId: string,
    manager: InstanceType<NonNullable<BleManagerModule>['BleManager']>,
  ) {
    const existingConnection = this.connections.get(peerDeviceId);
    if (existingConnection) {
      return existingConnection;
    }

    const connectedDevice = await manager.connectToDevice(peerDeviceId);
    await connectedDevice.discoverAllServicesAndCharacteristics();

    const connection = {
      monitor: undefined as { remove(): void } | undefined,
      cancelConnection: () => connectedDevice.cancelConnection(),
    };

    this.connections.set(peerDeviceId, connection);
    return connection;
  }
}

function loadBleManagerModule(): BleManagerModule | null {
  if (typeof require !== 'function') {
    return null;
  }

  try {
    return require('react-native-ble-plx') as BleManagerModule;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += alphabet[(chunk >> 18) & 0x3f];
    output += alphabet[(chunk >> 12) & 0x3f];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 0x3f] : '=';
    output += index + 2 < bytes.length ? alphabet[chunk & 0x3f] : '=';
  }

  return output;
}

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];

  for (let index = 0; index < cleaned.length; index += 4) {
    const a = alphabet.indexOf(cleaned[index] ?? 'A');
    const b = alphabet.indexOf(cleaned[index + 1] ?? 'A');
    const c = cleaned[index + 2] === '=' ? -1 : alphabet.indexOf(cleaned[index + 2] ?? 'A');
    const d = cleaned[index + 3] === '=' ? -1 : alphabet.indexOf(cleaned[index + 3] ?? 'A');

    const chunk = ((a & 0x3f) << 18) | ((b & 0x3f) << 12) | ((Math.max(c, 0) & 0x3f) << 6) | (Math.max(d, 0) & 0x3f);

    output.push((chunk >> 16) & 0xff);
    if (c >= 0) {
      output.push((chunk >> 8) & 0xff);
    }
    if (d >= 0) {
      output.push(chunk & 0xff);
    }
  }

  return new Uint8Array(output);
}
