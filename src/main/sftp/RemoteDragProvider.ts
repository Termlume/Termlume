import { mkdtemp, mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { AppError } from '../../shared/errors'
import type { DragProvider, DragStat } from './LazyDragTree'
import { RemoteFileAccess } from './RemoteFileAccess'
import { SftpService, sftpCall } from './SftpService'
/** Uses SFTP range reads; other file protocols materialize only a file actually read by the target. */
export class RemoteDragProvider implements DragProvider {
  private handles = new Map<string, Promise<{ channel: SFTPWrapper; handle: Buffer }>>()
  private local = new Map<string, Promise<string>>()
  private controller = new AbortController()
  private directory?: Promise<string>
  constructor(
    private id: string,
    private remote: RemoteFileAccess,
    private sftp: SftpService | undefined,
    private cache: string,
  ) {}
  realpath(path: string) {
    this.controller.signal.throwIfAborted()
    return this.remote.realpath(this.id, path)
  }
  async stat(path: string): Promise<DragStat | undefined> {
    this.controller.signal.throwIfAborted()
    const s = await this.remote.lstat(this.id, path)
    return (
      s && {
        directory: s.isDirectory(),
        size: s.size,
        modifiedAt: s.mtime * 1000,
        symlink: s.isSymbolicLink(),
      }
    )
  }
  async list(path: string) {
    const listing = await this.remote.list(this.id, path)
    return listing.entries.map((e) => ({
      name: e.name,
      directory: e.type === 'directory',
      size: e.size,
      modifiedAt: e.modifiedAt,
      symlink: e.isSymlink,
    }))
  }
  private handle(path: string) {
    let task = this.handles.get(path)
    if (!task) {
      task = (async () => {
        if (this.handles.size >= 16) {
          const first = this.handles.entries().next().value
          if (first) {
            this.handles.delete(first[0])
            const old = await first[1]
            await sftpCall<void>((cb) => old.channel.close(old.handle, cb))
          }
        }
        this.controller.signal.throwIfAborted()
        if ((await this.realpath(path)) !== path)
          throw new AppError('unsafe-link', 'Путь изменился')
        const stat = await this.stat(path)
        if (!stat || stat.symlink || stat.directory)
          throw new AppError('unsafe-link', 'Файл недоступен')
        const channel = await this.sftp!.get(this.id)
        const handle = await sftpCall<Buffer>((cb) => channel.open(path, 'r', cb))
        if (this.controller.signal.aborted) {
          channel.close(handle, () => {})
          this.controller.signal.throwIfAborted()
        }
        return { channel, handle }
      })()
      this.handles.set(path, task)
    }
    return task
  }
  async read(path: string, offset: number, length: number) {
    this.controller.signal.throwIfAborted()
    if (this.sftp) {
      const { channel, handle } = await this.handle(path)
      const buffer = Buffer.alloc(length)
      let next = 0
      // Small bounded requests avoid serial SSH round trips and server packet limits.
      await Promise.all(
        Array.from({ length: Math.min(8, Math.ceil(length / 16384)) }, async () => {
          while (next < length) {
            const start = next,
              size = Math.min(16384, length - start)
            next += size
            let done = 0
            while (done < size) {
              this.controller.signal.throwIfAborted()
              const count = await sftpCall<number>((cb) =>
                channel.read(
                  handle,
                  buffer,
                  start + done,
                  size - done,
                  offset + start + done,
                  (err, bytes) => cb(err, bytes),
                ),
              )
              if (!count) throw new AppError('source-changed', 'Файл изменился или чтение прервано')
              done += count
            }
          }
        }),
      )
      return buffer
    }
    let task = this.local.get(path)
    if (!task) {
      task = (async () => {
        if ((await this.realpath(path)) !== path)
          throw new AppError('unsafe-link', 'Путь изменился')
        this.directory ??= (async () => {
          await mkdir(this.cache, { recursive: true })
          return mkdtemp(join(this.cache, 'read-'))
        })()
        const directory = await this.directory
        const target = join(directory, String(this.local.size))
        await this.remote.transfer(
          {
            sessionId: this.id,
            direction: 'download',
            source: path,
            target,
            overwrite: false,
            localRoot: directory,
          },
          this.controller.signal,
          () => {},
        )
        return target
      })()
      this.local.set(path, task)
    }
    const file = await open(await task, 'r')
    try {
      this.controller.signal.throwIfAborted()
      const result = await file.read(Buffer.alloc(length), 0, length, offset)
      return result.buffer.subarray(0, result.bytesRead)
    } finally {
      await file.close()
    }
  }
  async close() {
    this.controller.abort()
    await Promise.allSettled(
      [...this.handles.values()].map(async (p) => {
        const { channel, handle } = await p
        await sftpCall<void>((cb) => channel.close(handle, cb))
      }),
    )
    await Promise.allSettled([...this.local.values()])
    if (this.directory) await rm(await this.directory, { recursive: true, force: true })
    this.handles.clear()
    this.local.clear()
  }
}
