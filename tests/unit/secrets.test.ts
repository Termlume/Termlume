import { it, expect } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretVault } from '../../src/main/storage/SecretVault'
it('unavailableEncryptionNeverWritesPlaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-vault-')),
    file = join(root, 'secrets.json')
  try {
    const vault = new SecretVault(file, {
      available: () => false,
      encrypt: () => {
        throw new Error('no')
      },
      decrypt: () => '',
    })
    await expect(vault.set('ref', 'private-password')).rejects.toThrow()
    expect(await readFile(file, 'utf8').catch(() => '')).not.toContain('private-password')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
