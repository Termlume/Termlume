import { expect, it } from 'vitest'
import { RemoteDragProvider } from '../../src/main/sftp/RemoteDragProvider'
import type { RemoteFileAccess } from '../../src/main/sftp/RemoteFileAccess'
import type { SftpService } from '../../src/main/sftp/SftpService'
it('pipelines bounded remote range reads instead of paying one network round trip per packet', async () => {
  const pending: (() => void)[] = []
  const channel = {
    open: (_p: string, _f: string, cb: Function) => cb(null, Buffer.from('handle')),
    close: (_h: Buffer, cb: Function) => cb(null),
    read: (_h: Buffer, b: Buffer, start: number, n: number, offset: number, cb: Function) =>
      pending.push(() => {
        for (let i = 0; i < n; i++) b[start + i] = (offset + i) % 251
        cb(null, n)
      }),
  }
  const remote = {
    realpath: async (p: string, _path?: string) => _path || p,
    lstat: async () => ({
      size: 65536,
      mtime: 1,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    }),
  } as unknown as RemoteFileAccess
  const provider = new RemoteDragProvider(
    'session',
    remote,
    { get: async () => channel } as unknown as SftpService,
    'unused',
  )
  const read = provider.read('/file', 0, 65536)
  await new Promise((resolve) => setTimeout(resolve, 10))
  const issued = pending.length
  for (const finish of pending) finish()
  const bytes = await read
  await provider.close()
  expect(bytes).toEqual(Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 251)))
  expect(issued).toBeGreaterThan(1)
  expect(issued).toBeLessThanOrEqual(8)
})
