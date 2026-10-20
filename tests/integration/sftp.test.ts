import { it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SftpService } from '../../src/main/sftp/SftpService'
import { ScpService } from '../../src/main/sftp/ScpService'
import { RemoteFileAccess } from '../../src/main/sftp/RemoteFileAccess'
async function connect(port: number) {
  const client = new Client()
  await new Promise<void>((resolve, reject) =>
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port,
        username: 'user',
        password: 'test-password',
        hostVerifier: () => true,
      }),
  )
  return client
}
it('missingSubsystemKeepsShellConnected', async () => {
  const server = await sshFixture(),
    client = await connect(server.port),
    service = new SftpService(() => client)
  try {
    await expect(service.list('session', '.')).rejects.toMatchObject({ code: 'sftp-unsupported' })
    expect(
      await new Promise<boolean>((resolve) =>
        client.shell((error, channel) => {
          channel?.close()
          resolve(!error)
        }),
      ),
    ).toBe(true)
  } finally {
    await service.close('session')
    client.end()
    await server.close()
  }
})
it('unicodeAndSpaceNamesRemainExact and permissionDeniedOnlyFailsOperation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-'))
  await writeFile(join(root, 'Отчёт 2026.txt'), 'content')
  const server = await sshFixture({ sftpRoot: root }),
    client = await connect(server.port),
    service = new SftpService(() => client)
  try {
    expect((await service.list('session', '/')).map((entry) => entry.name)).toContain(
      'Отчёт 2026.txt',
    )
    await expect(service.mkdir('session', '/denied')).rejects.toThrow()
    expect((await service.list('session', '/')).length).toBe(1)
    await service.mkdir('session', '/folder')
    await service.rename('session', '/folder', '/renamed')
    await service.remove('session', '/renamed', 'empty-directory')
  } finally {
    await service.close('session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('sets permissions on a remote path using the SFTP chmod request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-chmod-'))
  await writeFile(join(root, 'script.sh'), 'echo hello')
  const server = await sshFixture({ sftpRoot: root }),
    client = await connect(server.port),
    service = new SftpService(() => client)
  try {
    await expect(service.chmod('session', '/script.sh', 0o750)).resolves.toBeUndefined()
    expect((await service.list('session', '/'))[0].permissions).toBe(0o750)
  } finally {
    await service.close('session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('sets remote owner and group using resolved numeric SFTP principals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-chown-'))
  await writeFile(join(root, 'script.sh'), 'echo hello')
  const server = await sshFixture({ sftpRoot: root, scpRoot: root }),
    client = await connect(server.port),
    sftp = new SftpService(() => client),
    files = new RemoteFileAccess(sftp, new ScpService(() => client))
  try {
    await files.mutate({
      side: 'remote', sessionId: 'session', operation: 'chown', path: '/script.sh',
      owner: 'deploy-user', group: 'web-team',
    })
    expect(server.execRequests).toContain("getent passwd 'deploy-user'")
    expect(server.execRequests).toContain("getent group 'web-team'")
    const updated = (await files.list('session', '/')).entries[0]
    expect(updated.owner).toBe('user1201')
    expect(updated.group).toBe('group1302')
  } finally {
    await sftp.close('session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('prefers the SFTP subsystem when the server provides it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-preferred-'))
  await writeFile(join(root, 'preferred.txt'), 'content')
  const server = await sshFixture({ sftpRoot: root, scpRoot: root }),
    client = await connect(server.port),
    sftp = new SftpService(() => client),
    files = new RemoteFileAccess(sftp, new ScpService(() => client))
  try {
    const listing = await files.list('session', '/')
    expect(listing.mode).toBe('sftp')
    expect(listing.entries.map((entry) => entry.name)).toContain('preferred.txt')
    expect(listing.entries[0]).toMatchObject({
      owner: expect.stringMatching(/^user\d+$/),
      group: expect.stringMatching(/^group\d+$/),
    })
    expect(server.execRequests.every((command) => command.startsWith('getent '))).toBe(true)
  } finally {
    await sftp.close('session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
