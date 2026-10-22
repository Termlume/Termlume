import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream, createWriteStream, constants } from 'node:fs'
import { basename, dirname, join, relative, sep, isAbsolute, resolve, parse } from 'node:path'
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
      maxBuffer: 16 * 1024 * 1024,
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
  // DrvFS mount points are not accessible through the WSL UNC provider. Resolve
  // them with WSL, then retain the existing local adapter's canonical-path guards.
  private async nativeLocation(
    root: string,
    path: string,
    rejectLink = false,
  ): Promise<{ root: string; path: string }> {
    const target = resolve(root, path)
    const linux = this.linuxPath(root, target)
    const distribution = this.distribution(root)
    if (rejectLink) {
      const mode = await this.run(distribution, ['stat', '--printf=%f', '--', linux])
      if ((parseInt(mode.trim(), 16) & 0xf000) === 0xa000)
        throw new AppError('unsafe-link', 'Передача символических ссылок не поддерживается')
    }
    const parentLinux = linux === '/' ? '/' : this.linuxPath(root, dirname(target))
    const canonical = (
      await this.run(distribution, ['readlink', '-f', '--', linux === '/' ? '/' : parentLinux])
    ).trimEnd()
    if (!canonical.startsWith('/') || /[\0\r\n]/.test(canonical))
      throw new AppError('unsafe-path', 'Не удалось определить путь WSL')
    const windows = (await this.run(distribution, ['wslpath', '-w', canonical])).trimEnd()
    if (/^[a-z]:\\/i.test(windows))
      return {
        root: parse(windows).root,
        path: linux === '/' ? windows : join(windows, basename(target)),
      }
    // Resolve the mount itself (its parent may still belong to the distro).
    const direct = (await this.run(distribution, ['wslpath', '-w', linux])).trimEnd()
    if (/^[a-z]:\\/i.test(direct)) return { root: parse(direct).root, path: direct }
    const targetPath = join(
      root,
      ...canonical.split('/').filter(Boolean),
      ...(linux === '/' ? [] : [basename(target)]),
    )
    within(root, targetPath)
    return { root, path: targetPath }
  }
  async list(root: string, path: string): Promise<FileListing> {
    const distribution = this.distribution(root)
    if (!this.testDistribution) {
      const target = resolve(root, path === '.' ? root : path)
      const linux = this.linuxPath(root, target)
      // Reading names does not stat protected Windows system files. Keep those
      // names visible even when Linux cannot read their metadata.
      const names = (
        await this.run(distribution, [
          'find',
          '-H',
          linux,
          '-mindepth',
          '1',
          '-maxdepth',
          '1',
          '-printf',
          '%f\\0',
        ])
      )
        .split('\0')
        .filter(Boolean)
      const output = await this.run(distribution, [
        'find',
        '-H',
        linux,
        '-mindepth',
        '1',
        '-maxdepth',
        '1',
        '-printf',
        '%f\\0%y\\0%s\\0%T@\\0%m\\0%u\\0%g\\0',
      ]).catch((error: { code?: number; stdout?: string }) => {
        if (error.code === 1 && typeof error.stdout === 'string') return error.stdout
        throw error
      })
      const fields = output.split('\0')
      if (fields.pop() !== '' || fields.length % 7 !== 0)
        throw new AppError('wsl-metadata', 'Не удалось прочитать список файлов WSL')
      const entries: FileEntry[] = []
      for (let index = 0; index < fields.length; index += 7) {
        const [name, type, size, modifiedAt, permissions, owner, group] = fields.slice(
          index,
          index + 7,
        )
        if (
          !name ||
          /[\\/\0]/.test(name) ||
          !Number.isFinite(Number(size)) ||
          !Number.isFinite(Number(modifiedAt)) ||
          !/^[0-7]{1,4}$/.test(permissions)
        )
          throw new AppError('wsl-metadata', 'Некорректные данные файла WSL')
        entries.push({
          name,
          type: type === 'l' ? 'symlink' : type === 'd' ? 'directory' : 'file',
          isSymlink: type === 'l',
          size: Number(size),
          modifiedAt: Number(modifiedAt) * 1000,
          permissions: parseInt(permissions, 8),
          owner,
          group,
        })
      }
      const available = new Set(entries.map((entry) => entry.name))
      for (const name of names) {
        if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name))
          throw new AppError('wsl-metadata', 'Некорректное имя файла WSL')
        if (!available.has(name))
          entries.push({ name, type: 'file', size: 0, modifiedAt: 0, isSymlink: false })
      }
      return { path: target, entries, mode: 'wsl', capabilities }
    }
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
    if (!this.testDistribution) {
      this.linuxPath(root, resolve(root, request.path))
      if (request.operation !== 'mkdir' && resolve(root, request.path) === resolve(root))
        throw new AppError('root-operation', 'Нельзя изменить корневую папку')
      if (request.operation === 'chmod' || request.operation === 'chown') {
        await this.nativeLocation(root, request.path, true)
        const linux = this.linuxPath(root, resolve(root, request.path))
        if (request.operation === 'chown') {
          const identity = /^(?:[a-zA-Z_][a-zA-Z0-9_.-]*\$?|\d+)$/
          if (
            !request.owner ||
            !request.group ||
            !identity.test(request.owner) ||
            !identity.test(request.group)
          )
            throw new AppError('invalid-owner', 'Укажите корректного владельца и группу WSL')
          await this.run(distribution, ['chown', `${request.owner}:${request.group}`, '--', linux])
        } else {
          if (
            !Number.isInteger(request.permissions) ||
            request.permissions! < 0 ||
            request.permissions! > 0o7777
          )
            throw new AppError('invalid-permissions', 'Некорректные права файла')
          await this.run(distribution, ['chmod', request.permissions!.toString(8), '--', linux])
        }
        return
      }
      const location = await this.nativeLocation(root, request.path)
      const service = new LocalFilesService(location.root)
      if (request.operation === 'mkdir') return service.mkdir(location.path, request.name || '')
      if (request.operation === 'rename') return service.rename(location.path, request.name || '')
      return service.remove(location.path, request.fileType || 'file')
    }
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
  async move(root: string, source: string, destination: string): Promise<void> {
    const from = await this.nativeLocation(root, source, true)
    const to = await this.nativeLocation(root, destination)
    if (from.root.toLowerCase() !== to.root.toLowerCase())
      throw new AppError(
        'cross-device',
        'Для перемещения между файловыми системами используйте копирование',
      )
    return new LocalFilesService(from.root).move(from.path, to.path)
  }
  async accessiblePath(root: string, path: string, rejectLink = false): Promise<string> {
    const location = await this.nativeLocation(root, path, rejectLink)
    return ensureLocalPath(location.root, location.path)
  }
  async transfer(
    root: string,
    job: TransferJob,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
    depth = 0,
  ): Promise<void> {
    signal.throwIfAborted()
    if (!this.testDistribution && /^\\\\(?:wsl\.localhost|wsl\$)\\/i.test(root)) {
      const remote = job.direction === 'upload' ? job.target : job.source
      const location = await this.nativeLocation(root, remote, job.direction === 'download')
      await new WslFileAccess(this.run, this.distribution(root)).transfer(
        location.root,
        {
          ...job,
          ...(job.direction === 'upload' ? { target: location.path } : { source: location.path }),
        },
        signal,
        progress,
        depth,
      )
      return
    }
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
