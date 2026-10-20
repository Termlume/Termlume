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
import { ensureLocalPath, safeDownloadTarget } from './local-paths'
import { SftpService } from './SftpService'
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
  ) {}
  private async mode(id: string): Promise<'sftp' | 'scp'> {
    const current = this.modes.get(id)
    if (current) return current
    try {
      await this.sftp.get(id)
      this.modes.set(id, 'sftp')
      return 'sftp'
    } catch (error) {
      if ((error as AppError).code !== 'sftp-unsupported') throw error
      this.modes.set(id, 'scp')
      return 'scp'
    }
  }
  async list(id: string, path: string): Promise<FileListing> {
    const mode = await this.mode(id)
    if (mode === 'scp')
      return {
        path: await this.scp.realpath(id, path),
        entries: await this.scp.list(id, path),
        mode,
        capabilities: scpCapabilities,
      }
    const entries = await this.sftp.list(id, path)
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
    const mode = await this.mode(id)
    return mode === 'scp' ? this.scp.stat(id, path) : this.sftp.statOptional(id, path)
  }
  async lstat(id: string, path: string): Promise<RemoteStat | undefined> {
    return this.stat(id, path)
  }
  async realpath(id: string, path: string): Promise<string> {
    return (await this.mode(id)) === 'scp'
      ? this.scp.realpath(id, path)
      : this.sftp.realpath(id, path)
  }
  async mutate(request: FileMutation): Promise<void> {
    const id = request.sessionId
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
