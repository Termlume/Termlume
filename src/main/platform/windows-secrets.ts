import { safeStorage } from 'electron'
import type { CryptoProvider } from '../storage/SecretVault'
export const windowsSecrets: CryptoProvider = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
}
