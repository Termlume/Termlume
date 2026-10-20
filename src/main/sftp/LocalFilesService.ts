import * as fs from 'node:fs/promises'
import { join, dirname, basename, isAbsolute } from 'node:path'
import type { FileEntry, FileListing } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { ensureLocalPath, validateFileName } from './local-paths'
export class LocalFilesService {
  constructor(public root: string) {}
  async validateDroppedFile(path: string, root = this.root) {
    const original = await fs.lstat(path)
    if (original.isSymbolicLink() || (!original.isFile() && !original.isDirectory()))
      throw new AppError('regular-file-only', 'Перетаскивайте только обычные файлы')
    return ensureLocalPath(root, path)
  }
  /** Explicit OS drop grants access to this file, independently of the browser pane root. */
  async validateExternalDroppedFile(path: string): Promise<{ source: string; localRoot: string }> {
    if (!isAbsolute(path))
      throw new AppError('unsafe-path', 'Для перетаскивания нужен абсолютный путь файла')
    const original = await fs.lstat(path)
    if (original.isSymbolicLink() || (!original.isFile() && !original.isDirectory()))
      throw new AppError('regular-file-only', 'Перетаскивайте только обычные файлы')
    const localRoot = await fs.realpath(dirname(path))
    const source = await ensureLocalPath(localRoot, path)
    validateFileName(basename(source))
    return { source, localRoot }
  }
  async list(path: string): Promise<FileListing> {
    const target = await ensureLocalPath(this.root, path),
      names = await fs.readdir(target)
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          const stat = await fs.lstat(join(target, name))
          return {
            name,
            type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            isSymlink: stat.isSymbolicLink(),
            permissions: stat.mode & 0o7777,
          } as FileEntry
        } catch {
          return undefined
        }
      }),
    )
    return {
      path: target,
      entries: entries.filter((entry): entry is FileEntry => !!entry),
      mode: 'local',
      capabilities: {
        list: true,
        upload: false,
        download: false,
        mkdir: true,
        rename: true,
        remove: true,
        chmod: false,
        chown: false,
        dragOut: false,
      },
    }
  }
  async mkdir(path: string, name: string) {
    const parent = await ensureLocalPath(this.root, path)
    await fs.mkdir(join(parent, validateFileName(name)))
  }
  private async entryPath(path: string) {
    const parent = await ensureLocalPath(this.root, dirname(path))
    return join(parent, validateFileName(basename(path)))
  }
  async rename(path: string, name: string) {
    const target = await this.entryPath(path)
    if (target === (await fs.realpath(this.root)))
      throw new AppError('root-operation', 'Нельзя переименовать корневую папку')
    const destination = join(dirname(target), validateFileName(name))
    try {
      await fs.lstat(destination)
      throw new AppError('exists', 'Файл с таким именем уже существует')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.rename(target, destination)
  }
  async remove(path: string, type: 'file' | 'empty-directory') {
    const target = await this.entryPath(path)
    if (target === (await fs.realpath(this.root)))
      throw new AppError('root-operation', 'Нельзя удалить корневую папку')
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) await fs.unlink(target)
    else if (type === 'empty-directory') await fs.rmdir(target)
    else await fs.unlink(target)
  }
  async openCompleted(
    path: string,
    root: string,
    openPath: (path: string) => Promise<string | void>,
  ): Promise<void> {
    let original: Awaited<ReturnType<typeof fs.lstat>>
    try {
      original = await fs.lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('file-missing', 'Скачанный файл больше не существует')
      throw error
    }
    if (!original.isFile() || original.isSymbolicLink())
      throw new AppError('not-a-file', 'Открывать можно только завершённые обычные файлы')
    const target = await ensureLocalPath(root, path),
      error = await openPath(target)
    if (error) throw new AppError('open-failed', error)
  }
}
