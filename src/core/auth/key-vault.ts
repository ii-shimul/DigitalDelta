export type DeviceKeyMaterial = {
  deviceId: string;
  algorithm: 'ED25519';
  keyFingerprint: string;
  publicKeyPem: string;
  privateKeyPem: string;
  secretKeyHex: string;
  seedHex: string;
  storedAtMs: number;
};

export interface DeviceKeyVault {
  get(deviceId: string): Promise<DeviceKeyMaterial | null>;
  set(deviceId: string, material: DeviceKeyMaterial): Promise<void>;
  remove(deviceId: string): Promise<void>;
}

export class InMemoryDeviceKeyVault implements DeviceKeyVault {
  private readonly keyMaterials = new Map<string, DeviceKeyMaterial>();

  async get(deviceId: string): Promise<DeviceKeyMaterial | null> {
    return this.keyMaterials.get(deviceId) ?? null;
  }

  async set(deviceId: string, material: DeviceKeyMaterial): Promise<void> {
    this.keyMaterials.set(deviceId, material);
  }

  async remove(deviceId: string): Promise<void> {
    this.keyMaterials.delete(deviceId);
  }
}

export const defaultDeviceKeyVault = new InMemoryDeviceKeyVault();
