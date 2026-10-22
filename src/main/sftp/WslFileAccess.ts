import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream, createWriteStream, constants } from 'node:fs'
import { basename, dirname, join, relative, sep, isAbsolute } from 'node:path'
import type { FileCapabilities, FileEntry, FileListing, FileMutation } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import type { TransferJob } from './TransferQueue'
import { LocalFilesService } from './LocalFilesService'
import { ensureLocalPath, safeDownloadTarget } from './local-paths'
import { withCollisions } from './collisions'
import { TransferConflict } from './transfer-file'

export type WslCommandRunner = (distribution: string, args: string[]) => Promise<string>
const executeFile = promisify(execFile)
const runWsl: WslCommandRunner = async (distribution, args) => {
  const { stdout } = await executeFile(
    'wsl.exe',
    ['--distribution', distribution, '--exec', ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    },
  )
  return stdout
}
export function wslDistribution(root: string): string {
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\/]+)\\?$/i.exec(root)
  if (!match || /[\x00-\x1f]/.test(match[1]))
    throw new AppError('unsafe-path', 'Нужен корень выбранного дистрибутива WSL')
  return match[1]
}

const capabilities: FileCapabilities = {
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
const within = (root: string, target: string) => {
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new AppError('unsafe-path', 'Путь находится за пределами выбранного дистрибутива')
}
export class WslFileAccess {
  constructor(
    private readonly run: WslCommandRunner = runWsl,
    private readonly testDistribution?: string,
  ) {}
  private distribution(root: string): string {
    return this.testDistribution ?? wslDistribution(root)
  }
  private linuxPath(root: string, target: string): string {
    within(root, target)
    return '/' + relative(root, target).split(sep).join('/')
  }
  async list(root: string, path: string): Promise<FileListing> {
    const distribution = this.distribution(root)
    const target = await ensureLocalPath(root, path === '.' ? root : path)
    const names = await fs.readdir(target)
    const entries = await Promise.all(
      names.map(async (name): Promise<FileEntry | undefined> => {
        try {
          const stat = await fs.lstat(join(target, name))
          return {
            name,
            type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            isSymlink: stat.isSymbolicLink(),
            permissions: stat.mode & 0o7777,
          }
        } catch {
          return undefined
        }
      }),
    )
    const existing = entries.filter((entry): entry is FileEntry => !!entry)
    const canonicalRoot = await fs.realpath(root)
    // Batch metadata without launching one WSL process for every directory entry.
    for (let start = 0; start < existing.length; start += 64) {
      const batch = existing.slice(start, start + 64)
      const output = await this.run(distribution, [
        'stat',
        '--printf=%a\\t%u\\t%g\\t%U\\t%G\\n',
        '--',
        ...batch.map((entry) => this.linuxPath(canonicalRoot, join(target, entry.name))),
      ])
      const rows = output.trimEnd().split('\n')
      if (rows.length !== batch.length)
        throw new AppError('wsl-metadata', 'Не удалось прочитать права файлов WSL')
      batch.forEach((entry, index) => {
        const [mode, uid, gid, owner, group] = rows[index].split('\t')
        if (!/^[0-7]{1,4}$/.test(mode) || !/^\d+$/.test(uid) || !/^\d+$/.test(gid))
          throw new AppError('wsl-metadata', 'Некорректные права файла WSL')
        entry.permissions = parseInt(mode, 8)
        entry.owner = owner === 'UNKNOWN' ? uid : owner
        entry.group = group === 'UNKNOWN' ? gid : group
      })
    }
    return {
      path: target,
      entries: existing,
      mode: 'wsl',
      capabilities,
    }
  }
  async mutate(root: string, request: FileMutation): Promise<void> {
    const distribution = this.distribution(root)
    const service = new LocalFilesService(root)
    if (request.operation === 'mkdir') return service.mkdir(request.path, request.name || '')
    if (request.operation === 'rename') return service.rename(request.path, request.name || '')
    if (request.operation === 'remove')
      return service.remove(request.path, request.fileType || 'file')
    if ((await fs.lstat(request.path)).isSymbolicLink())
      throw new AppError('unsafe-link', 'Изменение прав символической ссылки не поддерживается')
    const target = await ensureLocalPath(root, request.path)
    const linuxPath = this.linuxPath(await fs.realpath(root), target)
    if (request.operation === 'chown') {
      const identity = /^(?:[a-zA-Z_][a-zA-Z0-9_.-]*\$?|\d+)$/
      if (
        !request.owner ||
        !request.group ||
        !identity.test(request.owner) ||
        !identity.test(request.group)
      )
        throw new AppError('invalid-owner', 'Укажите корректного владельца и группу WSL')
      await this.run(distribution, ['chown', `${request.owner}:${request.group}`, '--', linuxPath])
      return
    }
    if (
      !Number.isInteger(request.permissions) ||
      request.permissions! < 0 ||
      request.permissions! > 0o7777
    )
      throw new AppError('invalid-permissions', 'Некорректные права файла')
    await this.run(distribution, ['chmod', request.permissions!.toString(8), '--', linuxPath])
  }
  async transfer(
    root: string,
    job: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
    depth = 0,
  ): Promise<void> {
    signal.throwIfAborted()
    if (depth > 128) throw new AppError('directory-limit', 'Превышена глубина папок')
    const sourceRoot = job.direction === 'upload' ? job.localRoot : root
    if ((await fs.lstat(job.source)).isSymbolicLink())
      throw new AppError('unsafe-link', 'Передача символических ссылок не поддерживается')
    const source = await ensureLocalPath(sourceRoot, job.source)
    const stat = await fs.lstat(source)
    if (stat.isSymbolicLink())
      throw new AppError('unsafe-link', 'Передача символических ссылок не поддерживается')
    if (stat.isDirectory()) {
      const targetRoot = job.direction === 'upload' ? root : job.localRoot
      const target = await safeDownloadTarget(targetRoot, dirname(job.target), basename(job.target))
      const child = relative(source, target)
      if (child === '' || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)))
        throw new AppError('move-descendant', 'Нельзя копировать папку в неё саму или её подпапку')
      await fs.mkdir(target).catch(async (error) => {
        if (error.code !== 'EEXIST') throw error
        const existing = await fs.lstat(target)
        if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new AppError('invalid-destination', 'Назначение не является обычной папкой')
      })
      let done = 0
      for (const name of await fs.readdir(source)) {
        signal.throwIfAborted()
        let childDone = 0
        await this.transfer(
          root,
          { ...job, source: join(source, name), target: join(target, name) },
          signal,
          (bytes, total) => {
            childDone = bytes
            progress(done + bytes, done + total)
          },
          depth + 1,
        )
        done += childDone
      }
      progress(done, done)
      return
    }
    return withCollisions(job, signal, (request) =>
      this.transferSingle(root, request, signal, progress),
    )
  }
  private async transferSingle(
    root: string,
    job: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<void> {
    signal.throwIfAborted()
    const source =
      job.direction === 'upload'
        ? await ensureLocalPath(job.localRoot, job.source)
        : await ensureLocalPath(root, job.source)
    const target =
      job.direction === 'upload'
        ? await safeDownloadTarget(root, dirname(job.target), basename(job.target))
        : await safeDownloadTarget(job.localRoot, dirname(job.target), basename(job.target))
    within(
      job.direction === 'upload' ? await fs.realpath(root) : await fs.realpath(job.localRoot),
      target,
    )
    const inputStat = await fs.stat(source)
    if (!inputStat.isFile())
      throw new AppError('regular-file-only', 'Передавать можно только обычные файлы')
    const validateDestination = async () => {
      try {
        const stat = await fs.lstat(target)
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new AppError('invalid-destination', 'Назначение не является обычным файлом')
        const version = { size: stat.size, modifiedAt: stat.mtimeMs }
        if (!job.overwrite) throw new TransferConflict('exists', version)
        if (
          !job.targetVersion ||
          job.targetVersion.size !== version.size ||
          job.targetVersion.modifiedAt !== version.modifiedAt
        )
          throw new TransferConflict('destination-changed', version)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await validateDestination()
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.termlume-part`)
    let done = 0
    let abortTransfer: (() => void) | undefined
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const input = createReadStream(source)
        const output = createWriteStream(temp, { flags: 'wx' })
        abortTransfer = () => {
          input.destroy(new AppError('aborted', 'Передача отменена'))
          output.destroy()
        }
        signal.addEventListener('abort', abortTransfer, { once: true })
        input.on('data', (chunk: Buffer) => {
          done += chunk.length
          progress(done, inputStat.size)
        })
        input.on('error', reject)
        output.on('error', reject)
        output.on('finish', () => resolvePromise())
        input.pipe(output)
      })
      signal.throwIfAborted()
      await validateDestination()
      if (job.overwrite) await fs.rename(temp, target)
      else {
        try {
          await fs.link(temp, target)
        } catch (error) {
          if (
            !['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(
              (error as NodeJS.ErrnoException).code || '',
            )
          )
            throw error
          await fs.copyFile(temp, target, constants.COPYFILE_EXCL)
        }
        await fs.unlink(temp)
      }
      progress(inputStat.size, inputStat.size)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    } finally {
      if (abortTransfer) signal.removeEventListener('abort', abortTransfer)
    }
  }
}
