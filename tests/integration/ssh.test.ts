import { it, expect, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { SshAdapter } from '../../src/main/sessions/SshAdapter'
import { SshChallenges } from '../../src/main/sessions/SshChallenges'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
import { SecretVault } from '../../src/main/storage/SecretVault'
import { sshFixture } from './fixtures/ssh-server'
import type { HostProfile, AdapterEvent } from '../../src/shared/contracts'
const base: Extract<HostProfile, { protocol: 'ssh' }> = {
  id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
  name: 'test',
  protocol: 'ssh',
  host: '127.0.0.1',
  port: 22,
  username: 'user',
  auth: 'password',
  favorite: false,
  group: '',
  monitoringEnabled: false,
}
async function context(port: number) {
  const root = await mkdtemp(join(tmpdir(), 'terminal-ssh-')),
    known = new KnownHostsRepository(join(root, 'known.json')),
    challenges = new SshChallenges()
  const vault = new SecretVault(join(root, 'vault.json'), {
    available: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => '',
  })
  return {
    root,
    known,
    challenges,
    vault,
    profile: { ...base, port },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
it('uses shared login and vault password instead of stale server credentials across profiles', async () => {
  const fixture = await sshFixture({ username: 'shared-user', password: 'shared-password' }),
    ctx = await context(fixture.port)
  const vault = new SecretVault(join(ctx.root, 'shared-vault.json'), {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  })
  await vault.set('shared-ref', 'shared-password')
  await vault.set('stale-ref', 'wrong-password')
  try {
    for (const id of ['first', 'second']) {
      const adapter = new SshAdapter(
        { ...ctx.profile, id, username: 'wrong-user', secretRef: 'stale-ref' },
        {
          knownHosts: ctx.known,
          vault,
          challenges: ctx.challenges,
          ownerId: 1,
          sessionId: id,
          identity: {
            id: 'shared',
            name: 'Company',
            username: 'shared-user',
            method: 'password',
            secretRef: 'shared-ref',
          },
        },
      )
      adapter.subscribe((event) => {
        if (event.type === 'challenge')
          ctx.challenges.answer(1, event.challenge.id, {
            kind: 'trust',
            accept: true,
            replaceExisting: false,
          })
      })
      try {
        await adapter.connect(new AbortController().signal)
        expect(adapter.getClient()).toBeDefined()
      } finally {
        await adapter.close()
      }
    }
    expect(fixture.passwordAuthentications).toBe(2)
  } finally {
    await fixture.close()
    await ctx.cleanup()
  }
})
it('rejectsChangedHostKeyBeforeAuthentication', async () => {
  const fixture = await sshFixture(),
    ctx = await context(fixture.port)
  const remember = vi.fn(async () => {})
  const adapter = new SshAdapter(ctx.profile, {
    knownHosts: ctx.known,
    vault: ctx.vault,
    challenges: ctx.challenges,
    ownerId: 1,
    sessionId: 'session',
    initialSecret: 'test-password',
    remember,
  })
  try {
    await ctx.known.trust('127.0.0.1', fixture.port, Buffer.from('old-key'))
    adapter.subscribe((event) => {
      if (event.type === 'challenge')
        ctx.challenges.answer(1, event.challenge.id, {
          kind: 'trust',
          accept: false,
          replaceExisting: false,
        })
    })
    await expect(adapter.connect(new AbortController().signal)).rejects.toThrow()
    expect(fixture.authentications).toBe(0)
    expect(remember).not.toHaveBeenCalled()
  } finally {
    await adapter.close()
    await fixture.close()
    await ctx.cleanup()
  }
})
it('supportsPasswordAndEncryptedPrivateKey', async () => {
  const key = {
    private: generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: 'key-secret',
      },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
  }
  const parsed = utils.parseKey(key.private, 'key-secret')
  if (parsed instanceof Error) throw parsed
  const fixture = await sshFixture({ publicKey: parsed.getPublicSSH() }),
    ctx = await context(fixture.port)
  try {
    await writeFile(join(ctx.root, 'key'), key.private)
    for (const auth of ['password', 'key'] as const) {
      const remember = vi.fn(async () => {})
      const adapter = new SshAdapter(
        { ...ctx.profile, auth, keyPath: join(ctx.root, 'key') },
        {
          knownHosts: ctx.known,
          vault: ctx.vault,
          challenges: ctx.challenges,
          ownerId: 1,
          sessionId: auth,
          initialSecret: auth === 'password' ? 'test-password' : 'key-secret',
          remember,
        },
      )
      adapter.subscribe((event) => {
        if (event.type === 'challenge')
          ctx.challenges.answer(1, event.challenge.id, {
            kind: 'trust',
            accept: true,
            replaceExisting: false,
          })
      })
      await adapter.connect(new AbortController().signal)
      expect(adapter.getClient()).toBeDefined()
      expect(remember).toHaveBeenCalledOnce()
      expect(remember).toHaveBeenCalledWith(auth === 'password' ? 'test-password' : 'key-secret')
      await adapter.close()
    }
  } finally {
    await fixture.close()
    await ctx.cleanup()
  }
})
it('clears a stale stored secret, prompts again, and saves only the successful replacement', async () => {
  const fixture = await sshFixture(),
    ctx = await context(fixture.port),
    stale = vi.fn(async () => {}),
    saved: string[] = []
  const vault = {
    get: vi.fn(async () => 'old-password'),
    remove: vi.fn(async () => {}),
    set: vi.fn(async () => {}),
  } as unknown as SecretVault
  const adapter = new SshAdapter(
    { ...ctx.profile, secretRef: 'opaque-secret-ref' },
    {
      knownHosts: ctx.known,
      vault,
      challenges: ctx.challenges,
      ownerId: 1,
      sessionId: 'stale-secret',
      remember: async (value) => {
        saved.push(value)
      },
      clearStoredSecret: stale,
    },
  )
  adapter.subscribe((event) => {
    if (event.type === 'challenge')
      ctx.challenges.answer(
        1,
        event.challenge.id,
        event.challenge.kind === 'trust'
          ? { kind: 'trust', accept: true, replaceExisting: false }
          : { kind: 'auth', password: 'test-password', remember: true },
      )
  })
  try {
    await adapter.connect(new AbortController().signal)
    expect(vault.get).toHaveBeenCalledWith('opaque-secret-ref')
    expect(stale).toHaveBeenCalledOnce()
    expect(saved).toEqual(['test-password'])
    expect(fixture.passwordAuthentications).toBe(2)
  } finally {
    await adapter.close()
    await fixture.close()
    await ctx.cleanup()
  }
})
it('lateAuthAnswerCannotReopenClosedSession', async () => {
  const ctx = await context(22),
    abort = new AbortController()
  let challengeId = ''
  const pending = ctx.challenges.request(1, 'session', { kind: 'auth' }, abort.signal, (event) => {
    if (event.type === 'challenge') challengeId = event.challenge.id
  })
  const rejected = expect(pending).rejects.toThrow()
  abort.abort()
  await rejected
  expect(() =>
    ctx.challenges.answer(1, challengeId, { kind: 'auth', password: 'private', remember: false }),
  ).toThrow()
  await ctx.cleanup()
})
it('shellResizeReachesRemotePty', async () => {
  const fixture = await sshFixture(),
    ctx = await context(fixture.port)
  const adapter = new SshAdapter(ctx.profile, {
    knownHosts: ctx.known,
    vault: ctx.vault,
    challenges: ctx.challenges,
    ownerId: 1,
    sessionId: 'session',
    initialSecret: 'test-password',
  })
  adapter.subscribe((event) => {
    if (event.type === 'challenge')
      ctx.challenges.answer(1, event.challenge.id, {
        kind: 'trust',
        accept: true,
        replaceExisting: false,
      })
  })
  try {
    await adapter.connect(new AbortController().signal)
    adapter.resize(110, 32)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fixture.windowSize).toEqual({ cols: 110, rows: 32 })
    const echo = new Promise<string>((resolve) =>
      adapter.subscribe((event) => {
        if (event.type === 'data' && Buffer.from(event.data).toString().includes('ECHO:'))
          resolve(Buffer.from(event.data).toString())
      }),
    )
    adapter.write('hello')
    expect(await echo).toContain('ECHO:hello')
  } finally {
    await adapter.close()
    await fixture.close()
    await ctx.cleanup()
  }
})
