import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdentityRepository } from '../../src/main/storage/IdentityRepository'
import { parseOpenSshConfig } from '../../src/main/ssh/OpenSshConfig'
import { discoverSshIdentities } from '../../src/main/ssh/discover-identities'

let roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'terminal-identities-'))
  roots.push(root)
  return root
}

describe('SSH identities', () => {
  it('uses only SSH_AUTH_SOCK for Linux agents and resolves config keys relative to home', async () => {
    const home = await temp(),
      ssh = join(home, '.ssh')
    await mkdir(ssh)
    await writeFile(join(ssh, 'company'), 'key')
    await writeFile(join(ssh, 'config'), 'Host company\n IdentityFile .ssh/company\n')
    const agentFactory = vi.fn(() => ({
      getIdentities: (callback: (e: undefined, keys: never[]) => void) => callback(undefined, []),
    }))
    const identities = await discoverSshIdentities({
      home,
      platform: 'linux',
      env: { SSH_AUTH_SOCK: '/run/user/1000/keyring/ssh' },
      agentFactory: agentFactory as never,
    })
    expect(identities[0].keyPath).toBe(join(ssh, 'company'))
    expect(agentFactory).toHaveBeenCalledExactlyOnceWith('/run/user/1000/keyring/ssh')
  })
  it('preserves a shared login and arbitrary company name without storing plaintext fields', async () => {
    const root = await temp(),
      repository = new IdentityRepository(join(root, 'identities.json'))
    await repository.save({
      id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
      name: 'ООО Компания',
      username: 'deploy',
      method: 'password',
      password: 'private-password',
    } as never)
    expect(await repository.list()).toMatchObject([{ username: 'deploy', name: 'ООО Компания' }])
    expect(await readFile(join(root, 'identities.json'), 'utf8')).not.toContain('private-password')
  })
  it('persists only identity metadata and secret references', async () => {
    const root = await temp(),
      repository = new IdentityRepository(join(root, 'identities.json'))
    await repository.save({
      id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
      name: 'Production',
      method: 'password',
      secretRef: 'opaque-ref',
    })
    expect(await repository.list()).toMatchObject([
      { name: 'Production', method: 'password', secretRef: 'opaque-ref' },
    ])
    const raw = await readFile(join(root, 'identities.json'), 'utf8')
    expect(raw).toContain('opaque-ref')
    expect(raw).not.toContain('private-password')
  })

  it('parses OpenSSH host aliases and identity directives without losing multiword paths', () => {
    const hosts = parseOpenSshConfig(
      'Host production prod-*\n  HostName 192.0.2.10\n  User deploy\n  Port 2222\n  IdentityFile "~/.ssh/production key"\n  IdentitiesOnly yes\n\nHost *\n  User default-user',
    )
    expect(hosts[0]).toMatchObject({
      patterns: ['production', 'prod-*'],
      hostname: '192.0.2.10',
      user: 'deploy',
      port: 2222,
      identityFiles: ['~/.ssh/production key'],
      identitiesOnly: true,
    })
    expect(hosts[1].user).toBe('default-user')
  })

  it('discovers standard and configured keys and filters live Windows agent identities', async () => {
    const home = await temp(),
      ssh = join(home, '.ssh')
    await mkdir(ssh, { recursive: true })
    await writeFile(join(ssh, 'id_ed25519'), 'key')
    await writeFile(join(ssh, 'prod_key'), 'key')
    await writeFile(join(ssh, 'config'), 'Host production\n  IdentityFile ~/.ssh/prod_key\n')
    const agentKey = { getPublicSSH: () => Buffer.from('public-key') } as never
    const agentFactory = vi.fn((endpoint: string) => ({
      getIdentities(callback: (error: Error | undefined, keys?: (typeof agentKey)[]) => void) {
        callback(undefined, endpoint === 'pageant' ? [agentKey] : [])
      },
    }))
    const found = await discoverSshIdentities({
      home,
      platform: 'win32',
      env: {},
      agentFactory: agentFactory as never,
    })
    expect(
      found.filter((identity) => identity.method === 'key').map((identity) => identity.keyPath),
    ).toEqual(expect.arrayContaining([join(ssh, 'id_ed25519'), join(ssh, 'prod_key')]))
    expect(found.filter((identity) => identity.method === 'agent')).toHaveLength(1)
    expect(agentFactory).toHaveBeenCalledWith('pageant')
  })
})
