import * as fs from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors'
import { validateFileName } from './local-paths'
import { RemoteFileAccess } from './RemoteFileAccess'
import type { TransferJob } from './TransferQueue'

type StageTransfer = (request: TransferJob, signal: AbortSignal) => Promise<void>

export class ExternalDragService {
  private tokens = new Map<string, string>()
  private directories = new Set<string>()
  private controllers = new Set<AbortController>()
  private inFlight = new Set<Promise<{ token: string; fileName: string }>>()
  private closing = false
  private ready: Promise<void>

  constructor(
    private cacheRoot: string,
    private remoteFiles: RemoteFileAccess,
    private icon: string,
    private stageTransfer: StageTransfer,
  ) {
    this.ready = this.cleanStaleFiles()
  }

  private async cleanStaleFiles() {
    await fs.mkdir(this.cacheRoot, { recursive: true })
    const rootStat = await fs.lstat(this.cacheRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new AppError('unsafe-cache', 'Временная папка передач недоступна')
    for (const name of await fs.readdir(this.cacheRoot)) {
      if (!name.startsWith('drag-')) continue
      await fs.rm(join(this.cacheRoot, name), { recursive: true, force: true })
    }
  }

  prepare(sessionId: string, remotePath: string) {
    const task = this.prepareFile(sessionId, remotePath)
    this.inFlight.add(task)
    void task.then(
      () => this.inFlight.delete(task),
      () => this.inFlight.delete(task),
    )
    return task
  }

  private async prepareFile(sessionId: string, remotePath: string) {
    await this.ready
    if (this.closing) throw new AppError('closing', 'Приложение завершает работу')
    const original = await this.remoteFiles.lstat(sessionId, remotePath)
    if (!original || original.isSymbolicLink() || !original.isFile())
      throw new AppError('regular-file-only', 'Перетаскивать можно только обычные файлы')
    const canonical = await this.remoteFiles.realpath(sessionId, remotePath),
      canonicalStat = await this.remoteFiles.lstat(sessionId, canonical)
    if (!canonicalStat || canonicalStat.isSymbolicLink() || !canonicalStat.isFile())
      throw new AppError('regular-file-only', 'Перетаскивать можно только обычные файлы')
    const fileName = validateFileName(posix.basename(canonical)),
      directory = await fs.mkdtemp(join(this.cacheRoot, 'drag-')),
      controller = new AbortController()
    if (this.closing) {
      await fs.rm(directory, { recursive: true, force: true })
      throw new AppError('closing', 'Приложение завершает работу')
    }
    this.controllers.add(controller)
    try {
      await this.stageTransfer(
        {
          sessionId,
          direction: 'download',
          source: canonical,
          target: join(directory, fileName),
          overwrite: false,
          localRoot: directory,
        },
        controller.signal,
      )
      if (this.closing) throw new AppError('closing', 'Приложение завершает работу')
      const staged = await fs.lstat(join(directory, fileName))
      if (!staged.isFile() || staged.isSymbolicLink())
        throw new AppError('regular-file-only', 'Временная копия файла повреждена')
      const token = randomUUID(),
        path = join(directory, basename(fileName))
      this.tokens.set(token, path)
      this.directories.add(directory)
      return { token, fileName }
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true })
      throw error
    } finally {
      this.controllers.delete(controller)
    }
  }

  begin(token: string, startDrag: (file: string, icon: string) => void) {
    const path = this.tokens.get(token)
    if (!path || this.closing) return false
    try {
      startDrag(path, this.icon)
      this.tokens.delete(token)
      return true
    } catch {
      return false
    }
  }

  async close() {
    if (this.closing) return
    this.closing = true
    this.controllers.forEach((controller) => controller.abort())
    await Promise.allSettled([...this.inFlight])
    this.tokens.clear()
    await Promise.all(
      [...this.directories].map((directory) => fs.rm(directory, { recursive: true, force: true })),
    )
    this.directories.clear()
  }
}
