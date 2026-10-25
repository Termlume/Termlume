import { posix } from 'node:path'
import { AppError } from '../../shared/errors'
import { validateFileName } from './local-paths'
export interface DragStat {
  directory: boolean
  size: number
  modifiedAt: number
  symlink?: boolean
}
export interface DragProvider {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<DragStat | undefined>
  list(path: string): Promise<({ name: string } & DragStat)[]>
  read(path: string, offset: number, length: number): Promise<Buffer>
  close(): Promise<void>
}
/** Read-only export of one selected object; metadata access never fetches file bytes. */
export class LazyDragTree {
  readonly name: string
  private closed = false
  private stats = new Map<string, Promise<DragStat>>()
  constructor(
    readonly source: string,
    readonly initial: DragStat,
    private provider: DragProvider,
  ) {
    this.name = validateFileName(posix.basename(source), 'linux')
  }
  private remote(path: string) {
    if (this.closed) throw new AppError('canceled', 'Перенос завершён')
    const parts = path.split('/').slice(1)
    if (!path.startsWith('/') || parts[0] !== this.name || parts.length > 128)
      throw new AppError('unsafe-path', 'Путь вне выбранной папки')
    parts.forEach((part) => validateFileName(part, 'linux'))
    if (parts.length > 1 && !this.initial.directory)
      throw new AppError('unsafe-path', 'Путь вне выбранного файла')
    return (
      this.source +
      parts
        .slice(1)
        .map((p) => '/' + p)
        .join('')
    )
  }
  async stat(path: string): Promise<DragStat> {
    if (this.closed) throw new AppError('canceled', 'Перенос завершён')
    if (path === '/') return { directory: true, size: 0, modifiedAt: this.initial.modifiedAt }
    const remote = this.remote(path)
    let task = this.stats.get(path)
    if (!task) {
      if (this.stats.size >= 100000) throw new AppError('directory-limit', 'Слишком много файлов')
      task = (async () => {
        const stat = await this.provider.stat(remote)
        if (!stat) throw new AppError('file-missing', 'Файл не найден')
        if (stat.symlink) throw new AppError('unsafe-link', 'Файл является ссылкой')
        if ((await this.provider.realpath(remote)) !== remote)
          throw new AppError('unsafe-path', 'Путь изменился во время переноса')
        return stat
      })()
      this.stats.set(path, task)
      void task.catch(() => this.stats.delete(path))
    }
    return task
  }
  async list(path: string) {
    if (this.closed) throw new AppError('canceled', 'Перенос завершён')
    if (path === '/') return [this.name]
    if (!(await this.stat(path)).directory) throw new AppError('not-directory', 'Ожидалась папка')
    const entries = await this.provider.list(this.remote(path))
    if (entries.length > 100000) throw new AppError('directory-limit', 'Слишком много файлов')
    return entries.map((e) => validateFileName(e.name, 'linux'))
  }
  async read(path: string, offset: number, length: number) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 262144
    )
      throw new AppError('invalid-range', 'Недопустимый диапазон чтения')
    const stat = await this.stat(path)
    if (stat.directory) throw new AppError('not-file', 'Ожидался файл')
    const size = Math.max(0, Math.min(length, stat.size - offset))
    if (!size) return Buffer.alloc(0)
    const bytes = await this.provider.read(this.remote(path), offset, size)
    if (bytes.length !== size)
      throw new AppError('source-changed', 'Файл изменился или чтение прервано')
    return bytes
  }
  async close() {
    if (this.closed) return
    this.closed = true
    this.stats.clear()
    await this.provider.close()
  }
}
