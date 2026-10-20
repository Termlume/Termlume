import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { dirname, join, basename, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SFTPWrapper, Stats } from 'ssh2'
import { AppError } from '../../shared/errors'
import type { TransferRequest } from '../../shared/contracts'
import type { TransferJob } from './TransferQueue'
import { SftpService, sftpCall } from './SftpService'
import { ensureLocalPath, safeDownloadTarget } from './local-paths'
type Version = NonNullable<TransferRequest['targetVersion']>
export class TransferConflict extends AppError {
  constructor(
    code: string,
    public targetVersion: Version,
  ) {
    super(
      code,
      code === 'exists'
        ? 'Файл назначения уже существует'
        : 'Файл назначения изменился. Подтвердите замену заново.',
      true,
    )
  }
}
async function remoteStat(channel: SFTPWrapper, path: string): Promise<Stats | undefined> {
  return new Promise((resolve, reject) =>
    channel.lstat(path, (error, stat) => {
      if (error) {
        if ((error as Error & { code: number }).code === 2) resolve(undefined)
        else reject(new AppError('sftp-stat', 'Не удалось проверить удалённый файл', true))
      } else resolve(stat)
    }),
  )
}
function validateTarget(current: Version | undefined, request: TransferJob) {
  if (!current) return
  if (!request.overwrite) throw new TransferConflict('exists', current)
  if (
    !request.targetVersion ||
    request.targetVersion.size !== current.size ||
    request.targetVersion.modifiedAt !== current.modifiedAt
  )
    throw new TransferConflict('destination-changed', current)
}
export async function transferFile(
  service: SftpService,
  request: TransferJob,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<void> {
  signal.throwIfAborted()
  const channel = await service.get(request.sessionId)
  signal.throwIfAborted()
  let source = request.source,
    target = request.target,
    total = 0
  if (request.direction === 'upload') {
    source = await ensureLocalPath(request.localRoot, source)
    const stat = await fsp.stat(source)
    if (!stat.isFile()) throw new AppError('regular-file-only', 'Выберите обычный файл')
    total = stat.size
  } else {
    const stat = await remoteStat(channel, source)
    if (!stat || !stat.isFile() || stat.isSymbolicLink())
      throw new AppError('regular-file-only', 'Выберите обычный удалённый файл')
    total = stat.size
    target = await safeDownloadTarget(request.localRoot, dirname(target), basename(target))
  }
  const version = async (): Promise<Version | undefined> => {
    if (request.direction === 'upload') {
      const stat = await remoteStat(channel, target)
      if (stat?.isSymbolicLink() || stat?.isDirectory())
        throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
      return stat ? { size: stat.size, modifiedAt: stat.mtime * 1000 } : undefined
    }
    try {
      const stat = await fsp.lstat(target)
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
      return { size: stat.size, modifiedAt: stat.mtimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  validateTarget(await version(), request)
  signal.throwIfAborted()
  const tempName = '.terminal-' + randomUUID() + '.part',
    temp =
      request.direction === 'upload'
        ? posix.join(posix.dirname(target), tempName)
        : join(dirname(target), tempName)
  let finished = false,
    done = 0,
    created = false
  try {
    const reader =
      request.direction === 'upload'
        ? fs.createReadStream(source)
        : channel.createReadStream(source)
    const writer =
      request.direction === 'upload'
        ? channel.createWriteStream(temp, { flags: 'wx', mode: 0o600 })
        : fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 })
    created = true
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        done += chunk.length
        progress(done, total)
        callback(null, chunk)
      },
    })
    await pipeline(reader, meter, writer, { signal })
    signal.throwIfAborted()
    if (request.direction === 'download') {
      const file = await fsp.open(temp, 'r+')
      try {
        await file.sync()
      } finally {
        await file.close()
      }
    }
    const current = await version()
    validateTarget(current, request)
    signal.throwIfAborted()
    if (request.direction === 'upload') {
      if (current)
        await sftpCall<void>((callback) => channel.ext_openssh_rename(temp, target, callback))
      else await sftpCall<void>((callback) => channel.rename(temp, target, callback))
    } else if (current) await fsp.rename(temp, target)
    else {
      await fsp.link(temp, target)
      await fsp.unlink(temp)
    }
    finished = true
    progress(total, total)
  } finally {
    if (!finished && created) {
      try {
        if (request.direction === 'download') await fsp.unlink(temp)
        else
          await new Promise<void>((resolve, reject) =>
            channel.unlink(temp, (error) => (error ? reject(error) : resolve())),
          )
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (error as { code?: number }).code !== 2
        )
          throw new AppError(
            'partial-file-remains',
            'Не удалось удалить временный файл: ' + temp,
            true,
          )
      }
    }
  }
}
