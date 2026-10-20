import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SftpService } from '../../src/main/sftp/SftpService'
import { ScpService, quotePosixShellPath } from '../../src/main/sftp/ScpService'
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

it('falls back to SCP for file operations and quotes unusual remote paths', async () => {
  const base = await mkdtemp(join(tmpdir(), 'termlume-scp-')),
    remote = join(base, 'remote'),
    local = join(base, 'local')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, "initial ' ; $(touch injected).txt"), 'initial')
  await writeFile(join(local, "upload ' ; $(touch injected).txt"), 'uploaded')
  const server = await sshFixture({ scpRoot: remote }),
    client = await connect(server.port),
    sftp = new SftpService(() => client),
    scp = new ScpService(() => client),
    files = new RemoteFileAccess(sftp, scp)
  const sessionId = 'scp-session',
    signal = new AbortController().signal
  try {
    const listing = await files.list(sessionId, '/')
    expect(listing.mode).toBe('scp')
    expect(listing.entries.map((entry) => entry.name)).toContain(
      "initial ' ; $(touch injected).txt",
    )
    expect(
      listing.entries.find((entry) => entry.name === "initial ' ; $(touch injected).txt"),
    ).toMatchObject({ owner: expect.any(String), group: expect.any(String) })

    await files.mutate({
      side: 'remote',
      sessionId,
      operation: 'mkdir',
      path: '/',
      name: 'folder with spaces',
    })
    const remoteTarget = "/folder with spaces/upload ' ; $(touch injected).txt"
    await files.transfer(
      {
        sessionId,
        direction: 'upload',
        source: join(local, "upload ' ; $(touch injected).txt"),
        target: remoteTarget,
        overwrite: false,
        localRoot: local,
      },
      signal,
      () => {},
    )
    expect(
      await readFile(
        join(remote, 'folder with spaces', basename("upload ' ; $(touch injected).txt")),
        'utf8',
      ),
    ).toBe('uploaded')

    await files.mutate({
      side: 'remote',
      sessionId,
      operation: 'chmod',
      path: remoteTarget,
      permissions: 0o750,
    })
    expect((await files.stat(sessionId, remoteTarget))?.mode).toBe(0o750)
    await files.mutate({
      side: 'remote', sessionId, operation: 'chown', path: remoteTarget,
      owner: 'deploy-user', group: 'web-team',
    })
    expect(server.execRequests).toContain(`chown 1201:1302 -- ${quotePosixShellPath(remoteTarget)}`)
    await files.mutate({
      side: 'remote',
      sessionId,
      operation: 'rename',
      path: remoteTarget,
      name: 'renamed file.txt',
    })
    const renamed = '/folder with spaces/renamed file.txt',
      download = join(local, 'download.txt')
    await files.transfer(
      {
        sessionId,
        direction: 'download',
        source: renamed,
        target: download,
        overwrite: false,
        localRoot: local,
      },
      signal,
      () => {},
    )
    expect(await readFile(download, 'utf8')).toBe('uploaded')

    await expect(
      files.transfer(
        {
          sessionId,
          direction: 'upload',
          source: join(local, "upload ' ; $(touch injected).txt"),
          target: renamed,
          overwrite: false,
          localRoot: local,
        },
        signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'exists' })
    const current = await files.stat(sessionId, renamed)
    await files.transfer(
      {
        sessionId,
        direction: 'upload',
        source: join(local, "upload ' ; $(touch injected).txt"),
        target: renamed,
        overwrite: true,
        targetVersion: { size: current!.size, modifiedAt: current!.mtime * 1000 },
        localRoot: local,
      },
      signal,
      () => {},
    )
    expect(await readFile(join(remote, 'injected'), 'utf8').catch(() => '')).toBe('')
    await files.mutate({
      side: 'remote',
      sessionId,
      operation: 'remove',
      path: renamed,
      fileType: 'file',
    })
    await files.mutate({
      side: 'remote',
      sessionId,
      operation: 'remove',
      path: '/folder with spaces',
      fileType: 'empty-directory',
    })
  } finally {
    await sftp.close(sessionId)
    client.end()
    await server.close()
    await rm(base, { recursive: true, force: true })
  }
})

it('reports local write failures during an SCP download without an unhandled stream error', async () => {
  const base = await mkdtemp(join(tmpdir(), 'termlume-scp-write-error-')),
    remote = join(base, 'remote')
  await mkdir(remote)
  await writeFile(join(remote, 'source.txt'), 'download content')
  const server = await sshFixture({ scpRoot: remote }),
    client = await connect(server.port),
    scp = new ScpService(() => client)
  try {
    await expect(
      scp.get(
        'write-error',
        '/source.txt',
        join(base, 'missing-parent', 'download.txt'),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    client.end()
    await server.close()
    await rm(base, { recursive: true, force: true })
  }
})

it('keeps existing destination content when an SCP transfer is canceled before start', async () => {
  const base = await mkdtemp(join(tmpdir(), 'termlume-scp-cancel-')),
    remote = join(base, 'remote'),
    local = join(base, 'local')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'target.txt'), 'preserve')
  await writeFile(join(local, 'source.txt'), 'replace')
  const server = await sshFixture({ scpRoot: remote }),
    client = await connect(server.port),
    files = new RemoteFileAccess(new SftpService(() => client), new ScpService(() => client)),
    controller = new AbortController()
  controller.abort()
  try {
    await expect(
      files.transfer(
        {
          sessionId: 'cancel-session',
          direction: 'upload',
          source: join(local, 'source.txt'),
          target: '/target.txt',
          overwrite: true,
          localRoot: local,
        },
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(join(remote, 'target.txt'), 'utf8')).toBe('preserve')
  } finally {
    client.end()
    await server.close()
    await rm(base, { recursive: true, force: true })
  }
})

it('preserves the old remote destination when an SCP upload is canceled mid-stream', async () => {
  const base = await mkdtemp(join(tmpdir(), 'termlume-scp-mid-cancel-')),
    remote = join(base, 'remote'),
    local = join(base, 'local'),
    source = join(local, 'large.bin')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'target.bin'), 'preserve')
  await writeFile(source, Buffer.alloc(16 * 1024 * 1024, 7))
  const server = await sshFixture({ scpRoot: remote }),
    client = await connect(server.port),
    files = new RemoteFileAccess(new SftpService(() => client), new ScpService(() => client)),
    current = await files.stat('mid-cancel', '/target.bin'),
    controller = new AbortController()
  try {
    await expect(
      files.transfer(
        {
          sessionId: 'mid-cancel',
          direction: 'upload',
          source,
          target: '/target.bin',
          overwrite: true,
          targetVersion: { size: current!.size, modifiedAt: current!.mtime * 1000 },
          localRoot: local,
        },
        controller.signal,
        (done) => {
          if (done >= 64 * 1024) controller.abort()
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(join(remote, 'target.bin'), 'utf8')).toBe('preserve')
  } finally {
    client.end()
    await server.close()
    await rm(base, { recursive: true, force: true })
  }
})
