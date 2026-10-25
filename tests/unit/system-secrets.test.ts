import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: {} }))
import { createSystemSecrets } from '../../src/main/platform/system-secrets'

it('refuses insecure Linux secret storage while permitting a protected keyring', () => {
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: vi.fn(() => 'basic_text'),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  }
  expect(createSystemSecrets(storage as never, 'linux').available()).toBe(false)
  storage.getSelectedStorageBackend.mockReturnValue('unknown')
  expect(createSystemSecrets(storage as never, 'linux').available()).toBe(false)
  storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
  expect(createSystemSecrets(storage as never, 'linux').available()).toBe(true)
  storage.getSelectedStorageBackend.mockClear()
  expect(createSystemSecrets(storage as never, 'win32').available()).toBe(true)
  expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled()
})
