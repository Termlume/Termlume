import { safeStorage } from 'electron'
import type { CryptoProvider } from '../storage/SecretVault'

type Storage = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'
>
export function createSystemSecrets(
  storage: Storage,
  platform: string = process.platform,
): CryptoProvider {
  return {
    available: () =>
      storage.isEncryptionAvailable() &&
      (platform !== 'linux' ||
        !['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend())),
    encrypt: (value) => storage.encryptString(value),
    decrypt: (value) => storage.decryptString(value),
  }
}
export const systemSecrets = createSystemSecrets(safeStorage)
