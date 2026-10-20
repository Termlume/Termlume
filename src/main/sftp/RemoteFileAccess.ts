import * as fs from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'ssh2'
import type {
  FileCapabilities,
  FileListing,
  FileMutation,
  TransferRequest,
} from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { ensureLocalPath, safeDownloadTarget, validateFileName } from './local-paths'
import { SftpService } from './SftpService'
import type { FtpFileAccess } from './FtpFileAccess'
import { ScpService } from './ScpService'
import { TransferConflict, transferFile } from './transfer-file'
import type { TransferJob } from './TransferQueue'

const sftpCapabilities: FileCapabilities = {
  list: true,
  upload: true,
  download: true,
  mkdir: true,
  rename: true,
  remove: true,
  chmod: true,
  chown: true,
  dragOut: true,
}
const scpCapabilities: FileCapabilities = { ...sftpCapabilities }
type RemoteStat = Pick<
  Stats,
  'size' | 'mtime' | 'mode' | 'isFile' | 'isDirectory' | 'isSymbolicLink'
>

function checkVersion(current: RemoteStat | undefined, request: TransferRequest) {
  if (!current) return
  const value = { size: current.size, modifiedAt: current.mtime * 1000 }
  if (!request.overwrite) throw new TransferConflict('exists', value)
  if (
    !request.targetVersion ||
    request.targetVersion.size !== value.size ||
    request.targetVersion.modifiedAt !== value.modifiedAt
  )
    throw new TransferConflict('destination-changed', value)
}
function checkLocalVersion(
  current: { size: number; modifiedAt: number } | undefined,
  request: TransferRequest,
) {
  if (!current) return
  if (!request.overwrite) throw new TransferConflict('exists', current)
  if (
    !request.targetVersion ||
    request.targetVersion.size !== current.size ||
    request.targetVersion.modifiedAt !== current.modifiedAt
  )
    throw new TransferConflict('destination-changed', current)
}

export class RemoteFileAccess {
  private modes = new Map<string, 'sftp' | 'scp'>()
  constructor(
    private sftp: SftpService,
    private scp: ScpService,
    private standalone: (id: string) => boolean = () => false,
    private ftp?: { matches: (id: string) => boolean; provider: FtpFileAccess },
  ) {}
  private async mode(id: string): Promise<'sftp' | 'scp'> {
    const current = this.modes.get(id)
    if (current) return current
    try {
      await this.sftp.get(id)
      this.modes.set(id, 'sftp')
      return 'sftp'
    } catch (error) {
      if (this.standalone(id) || (error as AppError).code !== 'sftp-unsupported') throw error
      this.modes.set(id, 'scp')
      return 'scp'
    }
  }
  async list(id: string, path: string): Promise<FileListing> {
    if (this.ftp?.matches(id)) return this.ftp.provider.list(id, path)
    const mode = await this.mode(id)
    if (mode === 'scp')
      return {
        path: await this.scp.realpath(id, path),
        entries: await this.scp.list(id, path),
        mode,
        capabilities: scpCapabilities,
      }
    const entries = await this.sftp.list(id, path)
    if (!this.standalone(id))
      await Promise.all(
        entries.map(async (entry) => {
          ;[entry.owner, entry.group] = await Promise.all([
            this.scp.resolvePrincipal(id, 'passwd', entry.owner),
            this.scp.resolvePrincipal(id, 'group', entry.group),
          ])
        }),
      )
    return {
      path: await this.sftp.realpath(id, path),
      entries,
      mode,
      capabilities: sftpCapabilities,
    }
  }
  async stat(id: string, path: string): Promise<RemoteStat | undefined> {
    if (this.ftp?.matches(id)) return this.ftp.provider.stat(id, path)
    const mode = await this.mode(id)
    return mode === 'scp' ? this.scp.stat(id, path) : this.sftp.statOptional(id, path)
  }
  async lstat(id: string, path: string): Promise<RemoteStat | undefined> {
    return this.stat(id, path)
  }
  async realpath(id: string, path: string): Promise<string> {
    if (this.ftp?.matches(id)) return this.ftp.provider.realpath(id, path)
    return (await this.mode(id)) === 'scp'
      ? this.scp.realpath(id, path)
      : this.sftp.realpath(id, path)
  }
  async move(id: string, source: string, directory: string): Promise<void> {
    if (this.ftp?.matches(id)) return this.ftp.provider.move(id, source, directory)
    if ((await this.mode(id)) !== 'sftp')
      throw new AppError('files-unsupported', 'Перемещение внутри сервера требует SFTP; подключитесь по SFTP')
    const stat = await this.sftp.lstat(id, source)
    const targetStat = await this.sftp.lstat(id, directory)
    if (stat.isSymbolicLink() || targetStat.isSymbolicLink() || !targetStat.isDirectory())
      throw new AppError('unsafe-link', 'Перемещать можно только обычные файлы и папки без символических ссылок')
    const canonicalSource = await this.sftp.realpath(id, source)
    const canonicalDirectory = await this.sftp.realpath(id, directory)
    if (
      canonicalSource === '/' ||
      (stat.isDirectory() &&
        (canonicalDirectory === canonicalSource ||
          canonicalDirectory.startsWith(canonicalSource + '/')))
    )
      throw new AppError('move-descendant', 'Нельзя переместить папку в неё саму или её подпапку')
    await this.sftp.rename(id, source, posix.join(canonicalDirectory, posix.basename(source)))
  }
  async mutate(request: FileMutation): Promise<void> {
    const id = request.sessionId
    if (id && this.ftp?.matches(id)) return this.ftp.provider.mutate(request)
    if (!id) throw new AppError('files-session-required', 'Выберите SSH-сеанс')
    if ((await this.mode(id)) === 'scp') {
      const operation =
        request.operation === 'remove' ? request.fileType || 'file' : request.operation
      const path =
        request.operation === 'mkdir' ? posix.join(request.path, request.name!) : request.path
      return this.scp.mutate(
        id,
        request.operation,
        path,
        request.name || operation,
        request.permissions,
        false,
        request.owner,
        request.group,
      )
    }
    if (request.operation === 'chmod')
      return this.sftp.chmod(id, request.path, request.permissions!)
    if (request.operation === 'chown') {
      if (!request.owner || !request.group)
        throw new AppError('invalid-principal', 'Укажите владельца и группу')
      if (this.standalone(id)) {
        if (!/^\d+$/.test(request.owner) || !/^\d+$/.test(request.group))
          throw new AppError('invalid-principal', 'SFTP требует числовые UID и GID')
        const uid = Number(request.owner),
          gid = Number(request.group)
        if (
          !Number.isSafeInteger(uid) ||
          !Number.isSafeInteger(gid) ||
          uid > 0xffffffff ||
          gid > 0xffffffff
        )
          throw new AppError('invalid-principal', 'UID и GID должны быть 32-битными числами')
        return this.sftp.chown(id, request.path, uid, gid)
      }
      const [uid, gid] = await Promise.all([
        this.scp.resolvePrincipalId(id, 'passwd', request.owner),
        this.scp.resolvePrincipalId(id, 'group', request.group),
      ])
      return this.sftp.chown(id, request.path, uid, gid)
    }
    if (request.operation === 'mkdir')
      return this.sftp.mkdir(id, posix.join(request.path, request.name!))
    if (request.operation === 'rename')
      return this.sftp.rename(
        id,
        request.path,
        posix.join(posix.dirname(request.path), request.name!),
      )
    return this.sftp.remove(id, request.path, request.fileType || 'file')
  }
  async transfer(
    request: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<void> {
    signal.throwIfAborted()
    const source =
      request.direction === 'upload'
        ? await fs.lstat(await ensureLocalPath(request.localRoot, request.source))
        : await this.lstat(request.sessionId, request.source)
    if (source?.isSymbolicLink())
      throw new AppError('symlink-unsupported', 'Передача символических ссылок не поддерживается')
    if (!source?.isDirectory()) return this.transferSingle(request, signal, progress)
    const files: { source: string; target: string; size: number }[] = []
    const directories: string[] = []
    let total = 0,
      count = 0
    const scan = async (sourcePath: string, targetPath: string, depth: number): Promise<void> => {
      signal.throwIfAborted()
      if (depth > 128 || ++count > 100000)
        throw new AppError(
          'directory-limit',
          'Папка превышает ограничение глубины или количества файлов',
        )
      directories.push(targetPath)
      const entries =
        request.direction === 'upload'
          ? await Promise.all(
              (await fs.readdir(await ensureLocalPath(request.localRoot, sourcePath))).map(
                async (name) => {
                  const stat = await fs.lstat(join(sourcePath, name))
                  return {
                    name,
                    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'symlink',
                    size: stat.size,
                    isSymlink: stat.isSymbolicLink(),
                  }
                },
              ),
            )
          : (await this.list(request.sessionId, sourcePath)).entries
      for (const entry of entries) {
        signal.throwIfAborted()
        validateFileName(entry.name)
        if (entry.isSymlink || entry.type === 'symlink')
          throw new AppError(
            'symlink-unsupported',
            'Папка содержит символическую ссылку: ' + entry.name,
          )
        const from =
          request.direction === 'upload'
            ? join(sourcePath, entry.name)
            : posix.join(sourcePath, entry.name)
        const to =
          request.direction === 'upload'
            ? posix.join(targetPath, entry.name)
            : join(targetPath, entry.name)
        if (entry.type === 'directory') await scan(from, to, depth + 1)
        else {
          if (++count > 100000) throw new AppError('directory-limit', 'Слишком много файлов')
          files.push({ source: from, target: to, size: entry.size })
          total += entry.size
        }
      }
    }
    const stage =
      request.direction === 'upload'
        ? posix.join(posix.dirname(request.target), `.termlume-${randomUUID()}.part`)
        : join(dirname(request.target), `.termlume-${randomUUID()}.part`)
    await scan(request.source, stage, 0)
    const existing =
      request.direction === 'upload'
        ? await this.lstat(request.sessionId, request.target)
        : await fs.lstat(request.target).catch((error) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
    if (existing)
      throw new AppError(
        'directory-exists',
        'Папка назначения уже существует. Выберите новое имя папки; объединение папок не поддерживается.',
      )
    const completedFiles: string[] = [],
      createdDirectories: string[] = []
    const ftpCleanup =
      request.direction === 'upload' && this.ftp?.matches(request.sessionId)
        ? this.ftp.provider.stageCleanup(request.sessionId, stage)
        : undefined
    let committed = false
    try {
      for (const target of directories) {
        signal.throwIfAborted()
        if (request.direction === 'upload')
          await this.mutate({
            side: 'remote',
            sessionId: request.sessionId,
            path: posix.dirname(target),
            name: posix.basename(target),
            operation: 'mkdir',
          })
        else
          await fs.mkdir(
            await safeDownloadTarget(request.localRoot, dirname(target), basename(target)),
          )
        createdDirectories.push(target)
      }
      let done = 0
      for (const file of files) {
        await this.transferSingle(
          { ...request, ...file, overwrite: false, targetVersion: undefined },
          signal,
          (bytes) => progress(done + bytes, total),
        )
        completedFiles.push(file.target)
        done += file.size
      }
      signal.throwIfAborted()
      if (request.direction === 'upload')
        await this.mutate({
          side: 'remote',
          sessionId: request.sessionId,
          path: stage,
          name: posix.basename(request.target),
          operation: 'rename',
        })
      else {
        const target = await safeDownloadTarget(
          request.localRoot,
          dirname(request.target),
          basename(request.target),
        )
        await fs.rename(stage, target)
      }
      committed = true
    } finally {
      if (ftpCleanup) await ftpCleanup(committed)
      else if (!committed) {
        if (request.direction === 'download')
          await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
        else {
          for (const path of completedFiles.reverse())
            await this.mutate({
              side: 'remote',
              sessionId: request.sessionId,
              path,
              operation: 'remove',
              fileType: 'file',
            }).catch(() => {})
          for (const path of createdDirectories.reverse())
            await this.mutate({
              side: 'remote',
              sessionId: request.sessionId,
              path,
              operation: 'remove',
              fileType: 'empty-directory',
            }).catch(() => {})
        }
      }
    }
    progress(total, total)
  }
  private async transferSingle(
    request: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<void> {
    if (this.ftp?.matches(request.sessionId))
      return this.ftp.provider.transfer(request, signal, progress)
    const mode = await this.mode(request.sessionId)
    if (mode === 'sftp') return transferFile(this.sftp, request, signal, progress)
    signal.throwIfAborted()
    if (request.direction === 'upload') {
      const source = await ensureLocalPath(request.localRoot, request.source),
        localStat = await fs.stat(source)
      if (!localStat.isFile()) throw new AppError('regular-file-only', 'Выберите обычный файл')
      const current = await this.scp.stat(request.sessionId, request.target)
      if (current?.isDirectory() || current?.isSymbolicLink())
        throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
      checkVersion(current, request)
      const temp = posix.join(posix.dirname(request.target), `.termlume-${randomUUID()}.part`)
      try {
        await this.scp.put(request.sessionId, source, temp, signal, progress)
        signal.throwIfAborted()
        checkVersion(await this.scp.stat(request.sessionId, request.target), request)
        await this.scp.mutate(
          request.sessionId,
          'rename',
          temp,
          basename(request.target),
          undefined,
          request.overwrite,
        )
        progress(localStat.size, localStat.size)
      } catch (error) {
        await this.scp.mutate(request.sessionId, 'remove', temp).catch(() => {})
        throw error
      }
      return
    }
    const source = await this.scp.stat(request.sessionId, request.source)
    if (!source || !source.isFile() || source.isSymbolicLink())
      throw new AppError('regular-file-only', 'Выберите обычный удалённый файл')
    const target = await safeDownloadTarget(
      request.localRoot,
      dirname(request.target),
      basename(request.target),
    )
    const current = await fs
      .lstat(target)
      .then((stat) => {
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
        return { size: stat.size, mtime: stat.mtimeMs }
      })
      .catch((error) =>
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
      )
    checkLocalVersion(
      current && {
        size: current.size,
        modifiedAt: current.mtime,
      },
      request,
    )
    const temp = join(dirname(target), `.termlume-${randomUUID()}.part`)
    try {
      await this.scp.get(request.sessionId, request.source, temp, signal, progress)
      signal.throwIfAborted()
      checkLocalVersion(
        await fs
          .lstat(target)
          .then((stat) => {
            if (!stat.isFile() || stat.isSymbolicLink())
              throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
            return { size: stat.size, modifiedAt: stat.mtimeMs }
          })
          .catch((error) =>
            (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
          ),
        request,
      )
      if (request.overwrite) await fs.rename(temp, target)
      else {
        await fs.link(temp, target)
        await fs.unlink(temp)
      }
      progress(source.size, source.size)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }
  close(id: string) {
    this.modes.delete(id)
  }
}
