import { it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SftpService } from '../../src/main/sftp/SftpService'
import { ScpService } from '../../src/main/sftp/ScpService'
import { RemoteFileAccess } from '../../src/main/sftp/RemoteFileAccess'
import { WslFileAccess } from '../../src/main/sftp/WslFileAccess'

it('uploads and downloads nested/empty folders, merges and resolves file collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-folders-'))
  const remote = join(root, 'remote'),
    local = join(root, 'local')
  await mkdir(remote)
  await mkdir(join(local, 'tree', 'nested', 'empty'), { recursive: true })
  await writeFile(join(local, 'tree', 'nested', 'bytes.txt'), Buffer.from([0, 1, 255, 10]))
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
    files = new RemoteFileAccess(sftp, new ScpService(() => client))
  const signal = new AbortController().signal
  try {
    await files.transfer(
      {
        sessionId: 's',
        direction: 'upload',
        source: join(local, 'tree'),
        target: '/tree',
        localRoot: local,
        overwrite: false,
      },
      signal,
      () => {},
    )
    expect(await readFile(join(remote, 'tree', 'nested', 'bytes.txt'))).toEqual(
      Buffer.from([0, 1, 255, 10]),
    )
    expect(await readdir(join(remote, 'tree', 'nested', 'empty'))).toEqual([])
    const target = join(local, 'download')
    await files.transfer(
      {
        sessionId: 's',
        direction: 'download',
        source: '/tree',
        target,
        localRoot: local,
        overwrite: false,
      },
      signal,
      () => {},
    )
    await writeFile(join(target, 'nested', 'bytes.txt'), 'existing')
    await files.transfer(
      {
        sessionId: 's',
        direction: 'download',
        source: '/tree',
        target,
        localRoot: local,
        overwrite: false,
        resolveCollision: async () => 'keep-both',
      },
      signal,
      () => {},
    )
    expect(await readFile(join(target, 'nested', 'bytes.txt'), 'utf8')).toBe('existing')
    expect(await readFile(join(target, 'nested', 'bytes (2).txt'))).toEqual(
      Buffer.from([0, 1, 255, 10]),
    )
    await files.transfer(
      {
        sessionId: 's',
        direction: 'download',
        source: '/tree',
        target,
        localRoot: local,
        overwrite: false,
        resolveCollision: async () => 'replace',
      },
      signal,
      () => {},
    )
    expect(await readFile(join(target, 'nested', 'bytes.txt'))).toEqual(
      Buffer.from([0, 1, 255, 10]),
    )
  } finally {
    await sftp.close('s')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('copies local/WSL nested folders including empty folders and skips collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-local-folders-'))
  try {
    await mkdir(join(root, 'source', 'empty'), { recursive: true })
    await writeFile(join(root, 'source', 'a'), 'first')
    const files = new WslFileAccess(),
      signal = new AbortController().signal
    const job = {
      sessionId: 's',
      direction: 'download' as const,
      source: join(root, 'source'),
      target: join(root, 'target'),
      localRoot: root,
      overwrite: false,
    }
    await files.transfer(root, job, signal, () => {})
    await writeFile(join(root, 'source', 'a'), 'second')
    await files.transfer(
      root,
      { ...job, resolveCollision: async () => 'skip' as const },
      signal,
      () => {},
    )
    expect(await readFile(join(root, 'target', 'a'), 'utf8')).toBe('first')
    expect(await readdir(join(root, 'target', 'empty'))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
