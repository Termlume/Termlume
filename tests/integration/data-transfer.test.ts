import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostRepository } from '../../src/main/storage/HostRepository'
import { IdentityRepository } from '../../src/main/storage/IdentityRepository'
import { SettingsRepository } from '../../src/main/storage/SettingsRepository'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
import { SecretVault } from '../../src/main/storage/SecretVault'
import { DataImportTransaction } from '../../src/main/storage/DataImportTransaction'
import { decodePortableBackup, encodePortableBackup } from '../../src/main/storage/portable-backup'

it('imports the complete versioned app-data set while re-encrypting secrets locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-data-transfer-int-')),
    hosts = new HostRepository(join(root, 'hosts.json')),
    identities = new IdentityRepository(join(root, 'identities.json')),
    settings = new SettingsRepository(join(root, 'settings.json')),
    knownHosts = new KnownHostsRepository(join(root, 'known-hosts.json')),
    crypto = {
      available: () => true,
      encrypt: (value: string) => Buffer.from('local:' + value),
      decrypt: (value: Buffer) => value.toString().replace(/^local:/, ''),
    },
    vault = new SecretVault(join(root, 'secrets.json'), crypto)
  try {
    const hostId = '4f462e70-7dd6-46f5-9ea9-4928fb734654',
      identityId = 'be6d890c-c93f-4449-9705-1fc8b776ca6d'
    await identities.save({
      id: identityId,
      name: 'Router login',
      method: 'password',
      keyPath: 'C:\\keys\\router',
    })
    await hosts.save({
      id: hostId,
      name: 'Edge router',
      protocol: 'ssh',
      host: '192.0.2.10',
      port: 22,
      username: 'admin',
      auth: 'password',
      identityId,
      secretRef: hostId,
      favorite: true,
      group: 'Network',
      monitoringEnabled: true,
    })
    await vault.set(hostId, 'transfer-password')
    await settings.update({ themeId: 'tokyo-night', localShell: 'cmd' })
    await knownHosts.trust('192.0.2.10', 22, Buffer.from('host-key'))
    const payload = {
      hosts: await hosts.list(),
      identities: await identities.list(),
      settings: await settings.get(),
      knownHosts: await knownHosts.entries(),
      secrets: await vault.exportPlaintext(),
    }
    const archive = await encodePortableBackup(payload, 'portable-passphrase'),
      decoded = await decodePortableBackup(archive, 'portable-passphrase'),
      encryptedSecrets = vault.encryptAll(decoded.secrets)
    expect(archive.toString()).not.toContain('transfer-password')
    await new DataImportTransaction(root).apply(
      new Map([
        [hosts.store.path, hosts.store.serialize(decoded.hosts)],
        [identities.store.path, identities.store.serialize(decoded.identities)],
        [settings.path, settings.serialize(decoded.settings)],
        [knownHosts.path, knownHosts.serialize(decoded.knownHosts)],
        [vault.path, vault.serialize(encryptedSecrets)],
      ]),
    )
    expect(await new HostRepository(hosts.store.path).list()).toMatchObject([
      { id: hostId, favorite: true, identityId },
    ])
    expect((await new IdentityRepository(identities.store.path).list())[0].keyPath).toBe(
      'C:\\keys\\router',
    )
    expect((await new SettingsRepository(settings.path).get()).themeId).toBe('tokyo-night')
    expect(await new KnownHostsRepository(knownHosts.path).entries()).toEqual(payload.knownHosts)
    expect(await new SecretVault(vault.path, crypto).get(hostId)).toBe('transfer-password')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
