import { it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { SftpService } from '../../src/main/sftp/SftpService'
import { transferFile } from '../../src/main/sftp/transfer-file'
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
it('streamsZeroAnd16MiBFilesInBothDirectionsAndCleansCanceledParts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-transfer-')),
    remote = join(root, 'remote'),
    local = join(root, 'local')
  await mkdir(remote)
  await mkdir(local)
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
  const service = new SftpService(() => client)
  try {
    for (const length of [0, 16 * 1024 * 1024]) {
      const data = randomBytes(length),
        source = join(local, 'source-' + length)
      await writeFile(source, data)
      await transferFile(
        service,
        {
          sessionId: 'one',
          direction: 'upload',
          source,
          target: '/upload-' + length,
          overwrite: false,
          localRoot: local,
        },
        new AbortController().signal,
        () => {},
      )
      expect(hash(await readFile(join(remote, 'upload-' + length)))).toBe(hash(data))
      await transferFile(
        service,
        {
          sessionId: 'one',
          direction: 'download',
          source: '/upload-' + length,
          target: join(local, 'download-' + length),
          overwrite: false,
          localRoot: local,
        },
        new AbortController().signal,
        () => {},
      )
      expect(hash(await readFile(join(local, 'download-' + length)))).toBe(hash(data))
    }
    const abort = new AbortController()
    await expect(
      transferFile(
        service,
        {
          sessionId: 'one',
          direction: 'download',
          source: '/upload-16777216',
          target: join(local, 'canceled'),
          overwrite: false,
          localRoot: local,
        },
        abort.signal,
        () => abort.abort(),
      ),
    ).rejects.toThrow()
    expect((await readdir(local)).some((name) => name.endsWith('.part'))).toBe(false)
    expect(await readFile(join(local, 'canceled')).catch(() => undefined)).toBeUndefined()
  } finally {
    await service.close('one')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
it('destinationChangedRequiresNewDecision and temporaryFileNotFinalUntilSuccess', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-conflict-')),
    remote = join(root, 'remote'),
    local = join(root, 'local')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'source'), Buffer.alloc(65536, 1))
  await writeFile(join(local, 'target'), 'old')
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
  const service = new SftpService(() => client)
  try {
    await expect(
      transferFile(
        service,
        {
          sessionId: 'one',
          direction: 'download',
          source: '/source',
          target: join(local, 'target'),
          overwrite: true,
          targetVersion: { size: 2, modifiedAt: 0 },
          localRoot: local,
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'destination-changed' })
    expect(await readFile(join(local, 'target'), 'utf8')).toBe('old')
  } finally {
    await service.close('one')
    client.end()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
