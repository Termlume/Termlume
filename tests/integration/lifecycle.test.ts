import { it, expect } from 'vitest'
import { CloseCoordinator } from '../../src/main/lifecycle/close-coordinator'
import { diagnosticRecord } from '../../src/main/logging'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SessionManager } from '../../src/main/sessions/SessionManager'
import { SshAdapter } from '../../src/main/sessions/SshAdapter'
import { SshChallenges } from '../../src/main/sessions/SshChallenges'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
import { SecretVault } from '../../src/main/storage/SecretVault'
it('cancelCloseKeepsSessionAndTransfer', async () => {
  let resources = 2
  const coordinator = new CloseCoordinator(
    () => ({ sessions: 1, transfers: 1 }),
    async () => false,
    async () => {
      resources = 0
    },
    async () => {
      resources = 0
    },
  )
  expect(await coordinator.requestWindowClose(1)).toBe('canceled')
  expect(resources).toBe(2)
})
it('confirmedCloseDisposesOnce', async () => {
  let disposals = 0
  const coordinator = new CloseCoordinator(
    () => ({ sessions: 1, transfers: 1 }),
    async () => true,
    async () => {
      disposals++
    },
    async () => {
      disposals++
    },
  )
  const results = await Promise.all([
    coordinator.requestWindowClose(1),
    coordinator.requestWindowClose(1),
  ])
  expect(results).toEqual(['closed', 'closed'])
  expect(disposals).toBe(1)
})
it('secretsNeverReachLogs', () => {
  const record = diagnosticRecord('connection-error', {
    protocol: 'ssh',
    phase: 'connected',
    password: 'private-password',
    passphrase: 'private-key',
    message: 'terminal-content',
  } as any)
  expect(JSON.stringify(record)).not.toContain('private-password')
  expect(JSON.stringify(record)).not.toContain('private-key')
  expect(JSON.stringify(record)).not.toContain('terminal-content')
})
it('twentyConnectionCloseCyclesLeaveNoOwnedResources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-cycles-')),
    server = await sshFixture()
  const knownHosts = new KnownHostsRepository(join(root, 'known.json')),
    key = utils.parseKey(server.hostKey)
  if (key instanceof Error) throw key
  await knownHosts.trust('127.0.0.1', server.port, key.getPublicSSH())
  const vault = new SecretVault(join(root, 'vault.json'), {
      available: () => false,
      encrypt: () => Buffer.alloc(0),
      decrypt: () => '',
    }),
    challenges = new SshChallenges()
  let connected = () => {}
  const manager = new SessionManager(
    (profile, id) =>
      new SshAdapter(profile as any, {
        knownHosts,
        vault,
        challenges,
        ownerId: 1,
        sessionId: id,
        initialSecret: 'test-password',
      }),
    (_owner, event) => {
      if (event.type === 'state' && event.state === 'connected') connected()
    },
  )
  try {
    for (let count = 0; count < 20; count++) {
      const ready = new Promise<void>((resolve) => {
        connected = resolve
      })
      const id = await manager.open(1, {
        id: crypto.randomUUID(),
        name: 'loop',
        protocol: 'ssh',
        host: '127.0.0.1',
        port: server.port,
        username: 'user',
        auth: 'password',
        favorite: false,
        group: '',
        monitoringEnabled: false,
      })
      await ready
      await manager.close(1, id)
      expect(manager.count(1)).toBe(0)
    }
    await expect.poll(() => server.clientCount).toBe(0)
  } finally {
    await manager.closeOwner(1)
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
