import { expect, it } from 'vitest'
import { Server, type Connection } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshAdapter } from '../../src/main/sessions/SshAdapter'
import { SshChallenges } from '../../src/main/sessions/SshChallenges'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
import { SecretVault } from '../../src/main/storage/SecretVault'
import { X11Server } from '../../src/main/x11/X11Server'
import { x11Setup } from '../../src/main/x11/auth'

async function fixture(xauth = true, deny = false) {
  const clients = new Set<Connection>()
  let cookie = Buffer.alloc(0),
    connection: Connection | undefined
  const hostKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client)
    connection = client
    client.on('authentication', (ctx) => ctx.accept())
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (accept) => accept?.())
        session.on('exec', (accept) => {
          const stream = accept()
          stream.exit(xauth ? 0 : 127)
          stream.end()
        })
        session.on('x11', (accept, reject, info) => {
          cookie = Buffer.from(info.cookie.toString(), 'hex')
          if (deny) reject?.()
          else accept?.()
        })
        session.on('shell', (accept) => {
          const stream = accept()
          stream.write('terminal-ready')
          stream.on('data', (data) => stream.write(data))
        })
      }),
    )
    client.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const root = await mkdtemp(join(tmpdir(), 'x11-ssh-test-'))
  const challenges = new SshChallenges()
  const native = new X11Server(join(process.cwd(), 'build/x11/vcxsrv.exe'))
  const notices: string[] = [],
    terminal: string[] = []
  const adapter = new SshAdapter(
    {
      protocol: 'ssh',
      id: 'test',
      name: 'test',
      host: '127.0.0.1',
      port,
      username: 'test',
      auth: 'password',
      favorite: false,
      group: '',
      monitoringEnabled: false,
      x11Forwarding: true,
    },
    {
      knownHosts: new KnownHostsRepository(join(root, 'known.json')),
      vault: new SecretVault(join(root, 'vault.json'), {
        available: () => false,
        encrypt: () => Buffer.alloc(0),
        decrypt: () => '',
      }),
      challenges,
      ownerId: 1,
      sessionId: 'test',
      initialSecret: 'test',
      notice: (message) => notices.push(message),
      x11: () => native.acquire(true, false),
    },
  )
  adapter.subscribe((event) => {
    if (event.type === 'data') terminal.push(Buffer.from(event.data).toString())
    if (event.type === 'challenge')
      challenges.answer(1, event.challenge.id, {
        kind: 'trust',
        accept: true,
        replaceExisting: false,
      })
  })
  return {
    adapter,
    native,
    notices,
    terminal,
    get cookie() {
      return cookie
    },
    openX11: (auth: Buffer) =>
      new Promise<number>((resolve, reject) => {
        connection!.x11('127.0.0.1', 50000, (error, channel) => {
          if (error) return reject(error)
          const timer = setTimeout(() => {
            channel.close()
            reject(new Error('No X11 setup reply'))
          }, 3000)
          channel.once('data', (data) => {
            clearTimeout(timer)
            resolve(data[0])
            channel.close()
          })
          channel.once('close', () => {
            clearTimeout(timer)
            resolve(-1)
          })
          channel.on('error', () => {})
          // Exercise setup fragmentation across SSH channel packets.
          const setup = x11Setup(auth)
          channel.write(setup.subarray(0, 9))
          channel.write(setup.subarray(9))
        })
      }),
    close: async () => {
      await adapter.close()
      for (const client of clients) client.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await native.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

it.skipIf(process.platform !== 'win32' || !existsSync(join(process.cwd(), 'build/x11/vcxsrv.exe')))(
  'forwards a real SSH X11 channel to the native server and rejects the wrong session cookie',
  async () => {
    const ctx = await fixture()
    try {
      await ctx.adapter.connect(new AbortController().signal)
      expect(ctx.cookie).toHaveLength(16)
      expect(await ctx.openX11(ctx.cookie)).toBe(1)
      expect(await ctx.openX11(Buffer.alloc(16))).toBe(-1)
      expect(ctx.notices.some((message) => message.includes('cookie'))).toBe(true)
      ctx.adapter.write('still-alive')
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(ctx.terminal.join('')).toContain('still-alive')
      await ctx.adapter.close()
      expect((await ctx.native.status()).activeSessions).toBe(0)
    } finally {
      await ctx.close()
    }
  },
  20000,
)
it.each([
  { xauth: false, deny: false, message: 'xauth' },
  { xauth: true, deny: true, message: 'отклонил' },
])('keeps terminal usable when X11 is unavailable: $message', async ({ xauth, deny, message }) => {
  const ctx = await fixture(xauth, deny)
  try {
    await ctx.adapter.connect(new AbortController().signal)
    ctx.adapter.write('still-alive')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(ctx.terminal.join('')).toContain('still-alive')
    expect(ctx.notices.join('')).toContain(message)
  } finally {
    await ctx.close()
  }
})
