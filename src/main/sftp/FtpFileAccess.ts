import * as fs from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Client, FileInfo } from 'basic-ftp'
import type { FileCapabilities, FileListing, FileMutation } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { FtpAdapter } from '../sessions/FtpAdapter'
import type { TransferJob } from './TransferQueue'
import { TransferConflict } from './transfer-file'
import { ensureLocalPath, safeDownloadTarget, validateFileName } from './local-paths'

const capabilities: FileCapabilities = {
  list: true,
  upload: true,
  download: true,
  mkdir: true,
  rename: true,
  remove: true,
  chmod: false,
  chown: false,
  dragOut: true,
}
function safePath(path: string) {
  if (/[\r\n\0]/.test(path)) throw new AppError('unsafe-path', 'FTP не поддерживает этот путь')
  return path
}
function remoteStat(info: FileInfo) {
  return {
    size: info.size,
    mtime: info.modifiedAt ? info.modifiedAt.getTime() / 1000 : 0,
    mode: 0,
    isFile: () => info.isFile,
    isDirectory: () => info.isDirectory,
    isSymbolicLink: () => info.isSymbolicLink,
  }
}
async function lookup(client: Client, path: string) {
  safePath(path)
  if (path === '/' || path === '.') {
    const current = await client.pwd()
    try {
      await client.cd(path)
      return {
        size: 0,
        mtime: 0,
        mode: 0,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }
    } finally {
      await client.cd(current)
    }
  }
  const list = await client.list(posix.dirname(path))
  const info = list.find((entry) => entry.name === posix.basename(path))
  return info ? remoteStat(info) : undefined
}
export class FtpFileAccess {
  constructor(private adapter: (id: string) => FtpAdapter) {}
  async list(id: string, path: string): Promise<FileListing> {
    safePath(path)
    const adapter = this.adapter(id)
    return adapter.run(async (client) => {
      const current = await client.pwd()
      try {
        await client.cd(path)
        const resolved = await client.pwd()
        const entries = (await client.list())
          .filter((entry) => entry.name !== '.' && entry.name !== '..')
          .map((entry) => ({
            name: entry.name,
            type: entry.isSymbolicLink
              ? ('symlink' as const)
              : entry.isDirectory
                ? ('directory' as const)
                : ('file' as const),
            size: entry.size,
            modifiedAt: entry.modifiedAt?.getTime() || 0,
            isSymlink: entry.isSymbolicLink,
          }))
        return {
          path: resolved,
          entries,
          mode: adapter.profile.security === 'none' ? 'ftp' : 'ftps',
          capabilities,
        }
      } finally {
        await client.cd(current)
      }
    })
  }
  stat(id: string, path: string) {
    return this.adapter(id).run((client) => lookup(client, path))
  }
  lstat(id: string, path: string) {
    return this.stat(id, path)
  }
  realpath(id: string, path: string) {
    return this.adapter(id).run(async (client) => {
      safePath(path)
      return posix.resolve(await client.pwd(), path)
    })
  }
  mutate(request: FileMutation) {
    safePath(request.path)
    if (request.name) validateFileName(request.name)
    return this.adapter(request.sessionId!).run(async (client) => {
      if (request.operation === 'chmod' || request.operation === 'chown')
        throw new AppError('files-unsupported', 'FTP не поддерживает изменение прав и владельца')
      if (request.operation === 'mkdir') {
        const current = await client.pwd()
        try {
          await client.ensureDir(posix.join(request.path, request.name!))
        } finally {
          await client.cd(current)
        }
      } else if (request.operation === 'rename') {
        const target = posix.join(posix.dirname(request.path), request.name!)
        if (await lookup(client, target))
          throw new AppError('exists', 'Файл с таким именем уже существует')
        await client.rename(request.path, target)
      } else if (request.fileType === 'empty-directory') await client.send('RMD ' + request.path)
      else await client.remove(request.path)
    })
  }
  stageCleanup(id: string, path: string) {
    const adapter = this.adapter(id)
    return async (committed: boolean) => {
      if (committed) return
      try {
        await adapter.run((client) => client.removeDir(path))
      } catch {
        adapter.deferCleanup(path, true)
      }
    }
  }
  transfer(
    request: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ) {
    safePath(request.source)
    safePath(request.target)
    const adapter = this.adapter(request.sessionId)
    return adapter.run(async (client) => {
      const source =
        request.direction === 'upload'
          ? await ensureLocalPath(request.localRoot, request.source)
          : request.source
      const local = request.direction === 'upload' ? await fs.lstat(source) : undefined
      const remote = request.direction === 'download' ? await lookup(client, source) : undefined
      if (local?.isSymbolicLink() || remote?.isSymbolicLink())
        throw new AppError('symlink-unsupported', 'Передача символических ссылок не поддерживается')
      if (local?.isDirectory() || remote?.isDirectory())
        throw new AppError('directory-transfer', 'Передавайте папки через рекурсивную очередь')
      if (!(local?.isFile() || remote?.isFile()))
        throw new AppError('regular-file-only', 'Выберите обычный файл')
      const target =
        request.direction === 'download'
          ? await safeDownloadTarget(
              request.localRoot,
              dirname(request.target),
              basename(request.target),
            )
          : request.target
      const total = local?.size ?? remote!.size
      const version = async () => {
        if (request.direction === 'upload') {
          const current = await lookup(client, target)
          if (current && !current.isFile())
            throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
          return current && { size: current.size, modifiedAt: current.mtime * 1000 }
        }
        return fs
          .lstat(target)
          .then((current) => {
            if (!current.isFile() || current.isSymbolicLink())
              throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
            return { size: current.size, modifiedAt: current.mtimeMs }
          })
          .catch((error) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
      }
      const check = async () => {
        const current = await version()
        if (
          current &&
          (!request.overwrite ||
            current.size !== request.targetVersion?.size ||
            current.modifiedAt !== request.targetVersion?.modifiedAt)
        )
          throw new TransferConflict(request.overwrite ? 'destination-changed' : 'exists', current)
      }
      await check()
      signal.throwIfAborted()
      const temp =
        request.direction === 'upload'
          ? posix.join(posix.dirname(target), '.termlume-' + randomUUID() + '.part')
          : join(dirname(target), '.termlume-' + randomUUID() + '.part')
      let finished = false
      client.trackProgress((info) => progress(info.bytes, total))
      try {
        if (request.direction === 'upload') await client.uploadFrom(source, temp)
        else await client.downloadTo(temp, source)
        signal.throwIfAborted()
        await check()
        if (request.direction === 'upload') await client.rename(temp, target)
        else if (request.overwrite) await fs.rename(temp, target)
        else {
          await fs.link(temp, target)
          await fs.unlink(temp)
        }
        finished = true
        progress(total, total)
      } finally {
        client.trackProgress()
        if (!finished) {
          if (request.direction === 'upload') {
            if (client.closed) adapter.deferCleanup(temp)
            else
              await client.remove(temp, true).catch(() => {
                adapter.deferCleanup(temp)
              })
          } else await fs.rm(temp, { force: true }).catch(() => {})
        }
      }
    }, signal)
  }
}
