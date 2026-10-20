import * as fs from 'node:fs/promises'
import { resolve, relative, isAbsolute, posix } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
export function serveSftp(stream: SFTPWrapper, root: string) {
  let counter = 0
  const handles = new Map<string, { path: string; read?: boolean; file?: fs.FileHandle }>()
  const modeOverrides = new Map<string, number>()
  const ownerOverrides = new Map<string, { uid: number; gid: number }>()
  const local = (path: string) => {
    const full = resolve(root, '.' + posix.resolve('/', path))
    const rel = relative(root, full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('denied')
    return full
  }
  const attrs = (stat: Awaited<ReturnType<typeof fs.stat>>, path?: string) => ({
    mode: (path && modeOverrides.get(path)) ?? stat.mode,
    size: stat.size,
    uid: ownerOverrides.get(path || '')?.uid ?? 0,
    gid: ownerOverrides.get(path || '')?.gid ?? 0,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  })
  const fail = (id: number, error: any) => {
    if (!stream.destroyed)
      stream.status(id, error.code === 'ENOENT' ? 2 : error.code === 'EACCES' ? 3 : 4)
  }
  const run = (id: number, task: () => Promise<void>) =>
    void task().catch((error) => fail(id, error))
  const remember = (value: { path: string; read?: boolean; file?: fs.FileHandle }) => {
    const key = String(++counter)
    handles.set(key, value)
    return Buffer.from(key)
  }
  stream.on('error', () => {})
  stream.on('REALPATH', (id, path) =>
    stream.name(id, [
      {
        filename: posix.resolve('/', path),
        longname: '',
        attrs: { mode: 0o40755, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 },
      },
    ]),
  )
  stream.on('OPENDIR', (id, path) =>
    run(id, async () => {
      await fs.readdir(local(path))
      stream.handle(id, remember({ path: local(path) }))
    }),
  )
  stream.on('READDIR', (id, handle) =>
    run(id, async () => {
      const entry = handles.get(handle.toString())
      if (!entry) throw new Error('handle')
      if (entry.read) {
        stream.status(id, 1)
        return
      }
      entry.read = true
      const names = await fs.readdir(entry.path),
        list = await Promise.all(
          names.map(async (filename) => ({
            filename,
            longname: filename,
            attrs: attrs(
              await fs.lstat(resolve(entry.path, filename)),
              resolve(entry.path, filename),
            ),
          })),
        )
      if (list.length) stream.name(id, list)
      else stream.status(id, 1)
    }),
  )
  for (const event of ['STAT', 'LSTAT'] as const)
    stream.on(event, (id, path) =>
      run(id, async () => stream.attrs(id, attrs(await fs.lstat(local(path)), local(path)))),
    )
  stream.on('SETSTAT', (id, path, attributes) =>
    run(id, async () => {
      if (attributes.mode !== undefined) {
        const fullPath = local(path),
          current = await fs.lstat(fullPath)
        modeOverrides.set(fullPath, (current.mode & ~0o7777) | (attributes.mode & 0o7777))
      }
      if (attributes.uid !== undefined || attributes.gid !== undefined) {
        const fullPath = local(path), current = ownerOverrides.get(fullPath) ?? { uid: 0, gid: 0 }
        ownerOverrides.set(fullPath, {
          uid: attributes.uid ?? current.uid,
          gid: attributes.gid ?? current.gid,
        })
      }
      stream.status(id, 0)
    }),
  )
  stream.on('MKDIR', (id, path) =>
    run(id, async () => {
      if (path.startsWith('/denied')) {
        stream.status(id, 3)
        return
      }
      await fs.mkdir(local(path))
      stream.status(id, 0)
    }),
  )
  stream.on('RMDIR', (id, path) =>
    run(id, async () => {
      await fs.rmdir(local(path))
      stream.status(id, 0)
    }),
  )
  stream.on('REMOVE', (id, path) =>
    run(id, async () => {
      await fs.unlink(local(path))
      stream.status(id, 0)
    }),
  )
  stream.on('RENAME', (id, from, to) =>
    run(id, async () => {
      try {
        await fs.lstat(local(to))
        throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      } catch (error) {
        if ((error as any).code !== 'ENOENT') throw error
      }
      await fs.rename(local(from), local(to))
      stream.status(id, 0)
    }),
  )
  stream.on('OPEN', (id, path, flags) =>
    run(id, async () => {
      const mode = flags & 2 ? (flags & 32 ? 'wx' : flags & 16 ? 'w' : 'r+') : 'r'
      const file = await fs.open(local(path), mode)
      stream.handle(id, remember({ path: local(path), file }))
    }),
  )
  stream.on('READ', (id, handle, offset, length) =>
    run(id, async () => {
      const entry = handles.get(handle.toString())
      if (!entry?.file) throw new Error('handle')
      const buffer = Buffer.alloc(Math.min(length, 65536))
      const { bytesRead } = await entry.file.read(buffer, 0, buffer.length, offset)
      if (bytesRead) stream.data(id, buffer.subarray(0, bytesRead))
      else stream.status(id, 1)
    }),
  )
  stream.on('WRITE', (id, handle, offset, data) =>
    run(id, async () => {
      const entry = handles.get(handle.toString())
      if (!entry?.file) throw new Error('handle')
      let done = 0
      while (done < data.length) {
        const result = await entry.file.write(data, done, data.length - done, offset + done)
        done += result.bytesWritten
      }
      stream.status(id, 0)
    }),
  )
  stream.on('FSTAT', (id, handle) =>
    run(id, async () => {
      const entry = handles.get(handle.toString())
      if (!entry?.file) throw new Error('handle')
      stream.attrs(id, attrs(await entry.file.stat()))
    }),
  )
  stream.on('FSETSTAT', (id) => stream.status(id, 0))
  stream.on('CLOSE', (id, handle) =>
    run(id, async () => {
      const entry = handles.get(handle.toString())
      handles.delete(handle.toString())
      await entry?.file?.close()
      stream.status(id, 0)
    }),
  )
  stream.on('close', () => {
    handles.forEach((entry) => {
      void entry.file?.close().catch(() => {})
    })
    handles.clear()
  })
}
