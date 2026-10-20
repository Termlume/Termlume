import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SftpService } from '../../src/main/sftp/SftpService'
import { ScpService } from '../../src/main/sftp/ScpService'
import { RemoteFileAccess } from '../../src/main/sftp/RemoteFileAccess'
import { ExternalDragService } from '../../src/main/sftp/ExternalDragService'

import { TransferQueue } from '../../src/main/sftp/TransferQueue'

it('preparesOnlyRegularRemoteFilesAndConsumesExternalDragTokensOnce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-drag-')),
    remote = join(root, 'remote'),
    cache = join(root, 'cache')
  await mkdir(remote)
  await mkdir(join(cache, 'drag-stale'), { recursive: true })
  await writeFile(join(cache, 'drag-stale', 'old.tmp'), 'stale')
  await writeFile(join(remote, 'router.conf'), 'hostname edge-router')
  await symlink(remote, join(remote, 'linked-dir'), 'junction')
  const server = await sshFixture({ sftpRoot: remote }),
    client = new Client()
  await new Promise<void>((resolve, reject) =>
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port: server.port,
        username: 'user',
        password: 'test-password',
        hostVerifier: () => true,
      }),
  )
  const sftp = new SftpService(() => client),
    remoteFiles = new RemoteFileAccess(sftp, new ScpService(() => client)),
    queue = new TransferQueue((request, signal, progress) =>
      remoteFiles.transfer(request, signal, progress),
    ),
    drag = new ExternalDragService(cache, remoteFiles, 'app-icon', async (request, signal) => {
      const id = queue.enqueue(request),
        cancel = () => void queue.cancel(id)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await queue.waitFor(id)
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    })
  try {
    const prepared = await drag.prepare('session', '/router.conf')
    expect(queue.list().some((entry) => entry.state === 'completed')).toBe(true)
    await expect(readFile(join(cache, 'drag-stale', 'old.tmp'))).rejects.toThrow()
    expect(
      drag.begin(prepared.token, () => {
        throw new Error('native drag unavailable')
      }),
    ).toBe(false)
    const started: { file: string; icon: string }[] = []
    expect(drag.begin(prepared.token, (file, icon) => started.push({ file, icon }))).toBe(true)
    expect(started).toHaveLength(1)
    expect(started[0].icon).toBe('app-icon')
    expect(await readFile(started[0].file, 'utf8')).toBe('hostname edge-router')
    expect(drag.begin(prepared.token, () => {})).toBe(false)
    await expect(drag.prepare('session', '/linked-dir')).rejects.toThrow()
    await expect(drag.prepare('session', '/')).rejects.toThrow()
    await drag.close()
    await expect(readFile(started[0].file)).rejects.toThrow()
  } finally {
    await drag.close()
    await sftp.close('session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('prepares an external drag through SCP when SFTP is explicitly unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-scp-drag-')),
    remote = join(root, 'remote'),
    cache = join(root, 'cache')
  await mkdir(remote)
  await writeFile(join(remote, 'router.conf'), 'hostname edge-router')
  const server = await sshFixture({ scpRoot: remote }),
    client = new Client()
  await new Promise<void>((resolve, reject) =>
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port: server.port,
        username: 'user',
        password: 'test-password',
        hostVerifier: () => true,
      }),
  )
  const sftp = new SftpService(() => client),
    remoteFiles = new RemoteFileAccess(sftp, new ScpService(() => client)),
    queue = new TransferQueue((request, signal, progress) =>
      remoteFiles.transfer(request, signal, progress),
    ),
    drag = new ExternalDragService(cache, remoteFiles, 'app-icon', async (request, signal) => {
      const id = queue.enqueue(request),
        cancel = () => void queue.cancel(id)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await queue.waitFor(id)
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    })
  try {
    const prepared = await drag.prepare('scp-session', '/router.conf'),
      started: string[] = []
    expect(queue.list().some((entry) => entry.state === 'completed')).toBe(true)
    expect(drag.begin(prepared.token, (path) => started.push(path))).toBe(true)
    expect(await readFile(started[0], 'utf8')).toBe('hostname edge-router')
  } finally {
    await drag.close()
    await sftp.close('scp-session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('cancels a queued staging transfer and removes its private partial file on shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sftp-drag-cancel-')),
    remote = join(root, 'remote'),
    cache = join(root, 'cache')
  await mkdir(remote)
  await writeFile(join(remote, 'large.bin'), 'large payload')
  const server = await sshFixture({ sftpRoot: remote }),
    client = new Client()
  await new Promise<void>((resolve, reject) =>
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port: server.port,
        username: 'user',
        password: 'test-password',
        hostVerifier: () => true,
      }),
  )
  const sftp = new SftpService(() => client),
    remoteFiles = new RemoteFileAccess(sftp, new ScpService(() => client)),
    queue = new TransferQueue(
      (_request, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true })
        }),
    ),
    drag = new ExternalDragService(cache, remoteFiles, 'app-icon', async (request, signal) => {
      const id = queue.enqueue(request),
        cancel = () => void queue.cancel(id)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await queue.waitFor(id)
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    })
  try {
    const staging = drag.prepare('cancel-session', '/large.bin')
    await expect.poll(() => queue.list().some((entry) => entry.state === 'running')).toBe(true)
    await drag.close()
    await expect(staging).rejects.toMatchObject({ code: 'canceled' })
    expect(await readdir(cache)).toEqual([])
  } finally {
    await drag.close()
    await sftp.close('cancel-session')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
