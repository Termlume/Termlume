import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostProfile } from '../../src/shared/contracts'
import { SshAdapter } from '../../src/main/sessions/SshAdapter'
import { FtpAdapter } from '../../src/main/sessions/FtpAdapter'
import { SshChallenges } from '../../src/main/sessions/SshChallenges'
import { SessionManager } from '../../src/main/sessions/SessionManager'
import { SftpService } from '../../src/main/sftp/SftpService'
import { ScpService } from '../../src/main/sftp/ScpService'
import { RemoteFileAccess } from '../../src/main/sftp/RemoteFileAccess'
import { FtpFileAccess } from '../../src/main/sftp/FtpFileAccess'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
import type { SecretVault } from '../../src/main/storage/SecretVault'
import { sshFixture } from './fixtures/ssh-server'
import { ftpFixture } from './fixtures/ftp-server'

const base = {
  id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
  name: 'files',
  host: '127.0.0.1',
  username: 'user',
  group: '',
  favorite: false,
  tags: [],
}
const vault = { get: async () => 'test-password' } as unknown as SecretVault
it('SFTP-only account lists, uploads directories and downloads without shell, PTY, exec or SCP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-only-')),
    local = join(root, 'local'),
    remote = join(root, 'remote')
  await mkdir(local)
  await mkdir(remote)
  await mkdir(join(local, 'folder'))
  await mkdir(join(local, 'folder', 'nested'))
  await writeFile(join(local, 'folder', 'nested', 'hello.txt'), 'subsystem only')
  const server = await sshFixture({ fileOnly: true, sftpRoot: remote }),
    challenges = new SshChallenges()
  const profile: Extract<HostProfile, { protocol: 'sftp' }> = {
    ...base,
    protocol: 'sftp',
    auth: 'password',
    port: server.port,
  }
  const adapter = new SshAdapter(profile, {
    knownHosts: new KnownHostsRepository(join(root, 'known.json')),
    vault,
    challenges,
    ownerId: 1,
    sessionId: 'files',
    initialSecret: 'test-password',
    fileReady: () => sftp.get('files'),
  })
  adapter.subscribe((event) => {
    if (event.type === 'challenge')
      challenges.answer(1, event.challenge.id, {
        kind: 'trust',
        accept: true,
        replaceExisting: false,
      })
  })
  const sftp = new SftpService(() => adapter.getClient()),
    files = new RemoteFileAccess(sftp, new ScpService(() => adapter.getClient()), () => true)
  try {
    await adapter.connect(new AbortController().signal)
    await files.transfer(
      {
        sessionId: 'files',
        direction: 'upload',
        source: join(local, 'folder'),
        target: '/copy',
        overwrite: false,
        localRoot: local,
      },
      new AbortController().signal,
      () => {},
    )
    expect(await readFile(join(remote, 'copy', 'nested', 'hello.txt'), 'utf8')).toBe(
      'subsystem only',
    )
    expect((await files.list('files', '/copy/nested')).entries[0].owner).toMatch(/^\d+$/)
    await files.transfer(
      {
        sessionId: 'files',
        direction: 'download',
        source: '/copy',
        target: join(local, 'download'),
        overwrite: false,
        localRoot: local,
      },
      new AbortController().signal,
      () => {},
    )
    expect(await readFile(join(local, 'download', 'nested', 'hello.txt'), 'utf8')).toBe(
      'subsystem only',
    )
    await expect(
      files.mutate({
        sessionId: 'files',
        side: 'remote',
        path: '/copy',
        operation: 'chown',
        owner: 'named',
        group: 'named',
      }),
    ).rejects.toMatchObject({ code: 'invalid-principal' })
    expect(() => adapter.write('anything')).toThrow()
    expect(() => adapter.resize(80, 24)).toThrow()
    expect(server.shellRequests).toBe(0)
    expect(server.ptyRequests).toBe(0)
    expect(server.execRequests).toEqual([])
  } finally {
    await sftp.close('files')
    await adapter.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('FTP serializes passive operations, advertises capabilities and transfers recursive folders with conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-ftp-')),
    local = join(root, 'local'),
    remote = join(root, 'remote')
  await mkdir(local)
  await mkdir(remote)
  await mkdir(join(local, 'folder'))
  await writeFile(join(local, 'folder', 'hello.txt'), 'FTP content')
  const server = await ftpFixture(remote),
    remember = vi.fn(async () => {})
  const adapter = new FtpAdapter(
    { ...base, protocol: 'ftp', security: 'none', port: server.port },
    {
      vault,
      challenges: new SshChallenges(),
      ownerId: 1,
      sessionId: 'ftp',
      initialSecret: 'test-password',
      remember,
    },
  )
  const ftp = new FtpFileAccess(() => adapter),
    files = new RemoteFileAccess({} as SftpService, {} as ScpService, () => false, {
      matches: () => true,
      provider: ftp,
    })
  try {
    await adapter.connect(new AbortController().signal)
    expect(remember).toHaveBeenCalledWith('test-password')
    const listings = await Promise.all([files.list('ftp', '/'), files.list('ftp', '/')])
    expect(listings[0]).toMatchObject({ mode: 'ftp', capabilities: { chmod: false, chown: false } })
    await expect(
      files.mutate({
        side: 'remote',
        sessionId: 'ftp',
        path: '/',
        operation: 'chmod',
        permissions: 0o600,
      }),
    ).rejects.toMatchObject({ code: 'files-unsupported' })
    await files.transfer(
      {
        sessionId: 'ftp',
        direction: 'upload',
        source: join(local, 'folder'),
        target: '/uploaded',
        overwrite: false,
        localRoot: local,
      },
      new AbortController().signal,
      () => {},
    )
    expect(await readFile(join(remote, 'uploaded', 'hello.txt'), 'utf8')).toBe('FTP content')
    await files.transfer(
      {
        sessionId: 'ftp',
        direction: 'download',
        source: '/uploaded',
        target: join(local, 'copy'),
        overwrite: false,
        localRoot: local,
      },
      new AbortController().signal,
      () => {},
    )
    expect(await readFile(join(local, 'copy', 'hello.txt'), 'utf8')).toBe('FTP content')
    await expect(
      files.transfer(
        {
          sessionId: 'ftp',
          direction: 'upload',
          source: join(local, 'folder', 'hello.txt'),
          target: '/uploaded/hello.txt',
          overwrite: false,
          localRoot: local,
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'exists' })
    expect(server.commands).toContain('EPSV')
    await writeFile(join(remote, 'large.bin'), Buffer.alloc(1024 * 1024, 3))
    const cancel = new AbortController(),
      events: string[] = []
    adapter.subscribe((event) => {
      if (event.type === 'closed') events.push(event.reason || '')
    })
    await expect(
      files.transfer(
        {
          sessionId: 'ftp',
          direction: 'download',
          source: '/large.bin',
          target: join(local, 'canceled.bin'),
          overwrite: false,
          localRoot: local,
        },
        cancel.signal,
        (bytes) => {
          if (bytes > 0) cancel.abort()
        },
      ),
    ).rejects.toThrow()
    expect(events).toEqual(['transport'])
    await expect((await import('node:fs/promises')).readdir(local)).resolves.not.toContain(
      'canceled.bin',
    )
  } finally {
    await adapter.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('file sessions enforce owner and reject terminal write, resize and acknowledgement', async () => {
  const adapter = {
    connect: async () => {},
    subscribe: () => () => {},
    close: async () => {},
    write: vi.fn(),
    resize: vi.fn(),
    pauseOutput: () => {},
    resumeOutput: () => {},
  }
  const manager = new SessionManager(
    () => adapter,
    () => {},
  )
  const id = await manager.open(1, { ...base, protocol: 'ftp', security: 'none', port: 21 })
  await new Promise((done) => setImmediate(done))
  expect(() => manager.write(1, id, 'x')).toThrow()
  expect(() => manager.resize(1, id, 80, 24)).toThrow()
  expect(() => manager.ack(1, id, 1)).toThrow()
  expect(() => manager.get(2, id)).toThrow()
  expect(adapter.write).not.toHaveBeenCalled()
  expect(adapter.resize).not.toHaveBeenCalled()
  await manager.close(1, id)
})

it.each(['explicit-tls', 'implicit-tls'] as const)(
  'FTPS %s rejects an untrusted certificate before sending credentials',
  async (security) => {
    const { createServer: createNetServer } = await import('node:net')
    const {
      createServer: createTlsServer,
      TLSSocket,
      createSecureContext,
    } = await import('node:tls')
    const key = await readFile(join(import.meta.dirname, 'fixtures', 'ftps-key.pem'))
    const cert = await readFile(join(import.meta.dirname, 'fixtures', 'ftps-cert.pem'))
    const commands: string[] = [],
      sockets = new Set<import('node:net').Socket>()
    const secureContext = createSecureContext({ key, cert })
    const server =
      security === 'implicit-tls'
        ? createTlsServer({ key, cert }, (socket) => {
            socket.end('220 secured\r\n')
          })
        : createNetServer((socket) => {
            sockets.add(socket)
            socket.on('error', () => {})
            socket.write('220 TLS required\r\n')
            socket.once('data', (data) => {
              commands.push(data.toString())
              socket.write('234 Upgrade to TLS\r\n')
              const secured = new TLSSocket(socket, { isServer: true, secureContext })
              secured.on('error', () => {})
              sockets.add(secured)
            })
          })
    server.on('tlsClientError', () => {})
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('error', () => {})
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const adapter = new FtpAdapter(
      { ...base, protocol: 'ftp', security, port: (server.address() as { port: number }).port },
      {
        vault,
        challenges: new SshChallenges(),
        ownerId: 1,
        sessionId: 'ftps',
        initialSecret: 'test-password',
      },
    )
    try {
      await expect(adapter.connect(new AbortController().signal)).rejects.toMatchObject({
        code: 'ftp-connect',
      })
      expect(commands.join('')).not.toMatch(/USER|PASS/)
      if (security === 'explicit-tls') expect(commands.join('')).toContain('AUTH TLS')
    } finally {
      await adapter.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((done) => server.close(() => done()))
    }
  },
)

it('FTP cancellation stages folders safely and cleans only owned temporary paths on reconnect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-ftp-retry-')),
    local = join(root, 'local'),
    remote = join(root, 'remote')
  await mkdir(local)
  await mkdir(remote)
  await mkdir(join(local, 'folder'))
  await writeFile(join(local, 'folder', 'large.bin'), Buffer.alloc(1024 * 1024, 4))
  await writeFile(join(remote, 'keep.txt'), 'keep')
  const server = await ftpFixture(remote),
    profile = { ...base, protocol: 'ftp' as const, security: 'none' as const, port: server.port }
  const options = {
    vault,
    challenges: new SshChallenges(),
    ownerId: 1,
    sessionId: 'ftp',
    initialSecret: 'test-password',
  }
  let adapter = new FtpAdapter(profile, { ...options })
  const ftp = new FtpFileAccess(() => adapter),
    files = new RemoteFileAccess({} as SftpService, {} as ScpService, () => false, {
      matches: () => true,
      provider: ftp,
    })
  try {
    await adapter.connect(new AbortController().signal)
    const cancel = new AbortController(),
      request = {
        sessionId: 'ftp',
        direction: 'upload' as const,
        source: join(local, 'folder'),
        target: '/finished',
        overwrite: false,
        localRoot: local,
      }
    await expect(
      files.transfer(request, cancel.signal, (bytes) => {
        if (bytes > 0) cancel.abort()
      }),
    ).rejects.toThrow()
    await expect(
      (await import('node:fs/promises')).stat(join(remote, 'finished')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await adapter.close()
    adapter = new FtpAdapter(profile, { ...options })
    await adapter.connect(new AbortController().signal)
    expect(await (await import('node:fs/promises')).readdir(remote)).toEqual(['keep.txt'])
    await files.transfer(request, new AbortController().signal, () => {})
    expect((await readFile(join(remote, 'finished', 'large.bin'))).length).toBe(1024 * 1024)
    expect(await readFile(join(remote, 'keep.txt'), 'utf8')).toBe('keep')
  } finally {
    await adapter.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['sftp', 'ftp'] as const)(
  '%s does not persist a prompted password when remember is unchecked',
  async (protocol) => {
    const root = await mkdtemp(join(tmpdir(), 'termlume-remember-'))
    const server =
      protocol === 'sftp'
        ? await sshFixture({ sftpRoot: root, fileOnly: true })
        : await ftpFixture(root)
    const challenges = new SshChallenges(),
      remember = vi.fn(async () => {})
    const options = { vault, challenges, ownerId: 1, sessionId: protocol, remember }
    const adapter =
      protocol === 'ftp'
        ? new FtpAdapter({ ...base, protocol, security: 'none', port: server.port }, options)
        : new SshAdapter(
            { ...base, protocol, auth: 'password', port: server.port },
            { ...options, knownHosts: new KnownHostsRepository(join(root, 'known.json')) },
          )
    adapter.subscribe((event) => {
      if (event.type === 'challenge')
        challenges.answer(
          1,
          event.challenge.id,
          event.challenge.kind === 'auth'
            ? { kind: 'auth', password: 'test-password', remember: false }
            : { kind: 'trust', accept: true, replaceExisting: false },
        )
    })
    try {
      await adapter.connect(new AbortController().signal)
      expect(remember).not.toHaveBeenCalled()
    } finally {
      await adapter.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)

it('a second FTP login preserves an active stage; canceled folder download removes its local stage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-ftp-concurrent-')),
    local = join(root, 'local'),
    remote = join(root, 'remote')
  await mkdir(local)
  await mkdir(remote)
  await mkdir(join(remote, 'folder'))
  await writeFile(join(remote, 'folder', 'large.bin'), Buffer.alloc(1024 * 1024, 2))
  const server = await ftpFixture(remote),
    profile = { ...base, protocol: 'ftp' as const, security: 'none' as const, port: server.port }
  const options = {
    vault,
    challenges: new SshChallenges(),
    ownerId: 1,
    sessionId: 'ftp',
    initialSecret: 'test-password',
  }
  const first = new FtpAdapter(profile, { ...options }),
    second = new FtpAdapter(profile, { ...options })
  const ftp = new FtpFileAccess(() => first),
    files = new RemoteFileAccess({} as SftpService, {} as ScpService, () => false, {
      matches: () => true,
      provider: ftp,
    })
  try {
    await first.connect(new AbortController().signal)
    await files.mutate({
      side: 'remote',
      sessionId: 'ftp',
      path: '/',
      operation: 'mkdir',
      name: '.termlume-active.part',
    })
    const cleanup = ftp.stageCleanup('ftp', '/.termlume-active.part')
    await second.connect(new AbortController().signal)
    expect(
      (
        await (await import('node:fs/promises')).stat(join(remote, '.termlume-active.part'))
      ).isDirectory(),
    ).toBe(true)
    await cleanup(false)
    const cancel = new AbortController()
    await expect(
      files.transfer(
        {
          sessionId: 'ftp',
          direction: 'download',
          source: '/folder',
          target: join(local, 'canceled-folder'),
          overwrite: false,
          localRoot: local,
        },
        cancel.signal,
        (bytes) => {
          if (bytes > 0) cancel.abort()
        },
      ),
    ).rejects.toThrow()
    expect(await (await import('node:fs/promises')).readdir(local)).toEqual([])
    expect((await readFile(join(remote, 'folder', 'large.bin'))).length).toBe(1024 * 1024)
  } finally {
    await first.close()
    await second.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
