export type DeviceKeyMaterial = {
  deviceId: string;
  algorithm: 'ED25519';
  keyFingerprint: string;
  publicKeyPem: string;
  privateKeyPem: string;
  secretKeyHex: string;
  seedHex: string;
  storedAtMs: number;
  meshPublicKeyBase64?: string;
  meshSecretKeyBase64?: string;
};

export interface DeviceKeyVault {
  get(deviceId: string): Promise<DeviceKeyMaterial | null>;
  set(deviceId: string, material: DeviceKeyMaterial): Promise<void>;
  remove(deviceId: string): Promise<void>;
}

type KeychainModule = {
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: string;
  };
  SECURITY_LEVEL: {
    SECURE_HARDWARE?: string | number;
    SECURE_SOFTWARE?: string | number;
  };
  STORAGE_TYPE: {
    AES_GCM_NO_AUTH?: string;
  };
  getGenericPassword(options?: Record<string, unknown>): Promise<
    | false
    | {
        username: string;
        password: string;
      }
  >;
  setGenericPassword(
    username: string,
    password: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  resetGenericPassword(options?: Record<string, unknown>): Promise<boolean>;
};

declare const require: undefined | ((moduleName: string) => unknown);

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

export class SecureDeviceKeyVault implements DeviceKeyVault {
  constructor(private readonly fallbackVault: DeviceKeyVault) {}

  async get(deviceId: string): Promise<DeviceKeyMaterial | null> {
    const keychain = loadKeychainModule();
    if (!keychain) {
      return this.fallbackVault.get(deviceId);
    }

    const credentials = await keychain.getGenericPassword({
      service: getKeychainServiceName(deviceId),
    });

    if (!credentials) {
      return this.fallbackVault.get(deviceId);
    }

    const parsedMaterial = parseKeyMaterial(credentials.password);
    return parsedMaterial ?? this.fallbackVault.get(deviceId);
  }

  async set(deviceId: string, material: DeviceKeyMaterial): Promise<void> {
    const keychain = loadKeychainModule();
    await this.fallbackVault.set(deviceId, material);

    if (!keychain) {
      return;
    }

    await keychain.setGenericPassword(deviceId, JSON.stringify(material), {
      service: getKeychainServiceName(deviceId),
      accessible: keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel:
        keychain.SECURITY_LEVEL.SECURE_HARDWARE ??
        keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
      storage: keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
  }

  async remove(deviceId: string): Promise<void> {
    const keychain = loadKeychainModule();
    await this.fallbackVault.remove(deviceId);

    if (!keychain) {
      return;
    }

    await keychain.resetGenericPassword({
      service: getKeychainServiceName(deviceId),
    });
  }
}

export function createSecureDeviceKeyVault(
  fallbackVault: DeviceKeyVault = defaultDeviceKeyVault,
): DeviceKeyVault {
  return new SecureDeviceKeyVault(fallbackVault);
}

function getKeychainServiceName(deviceId: string): string {
  return `digitaldelta.auth.device-key.${deviceId}`;
}

function loadKeychainModule(): KeychainModule | null {
  if (typeof require !== 'function') {
    return null;
  }

  try {
    const loadedModule = require('react-native-keychain') as {
      default?: KeychainModule;
    } & KeychainModule;
    return loadedModule.default ?? loadedModule;
  } catch {
    return null;
  }
}

function parseKeyMaterial(serializedValue: string): DeviceKeyMaterial | null {
  try {
    const parsedValue = JSON.parse(serializedValue) as DeviceKeyMaterial;
    if (!parsedValue || typeof parsedValue !== 'object') {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}
