import * as fs from 'node:fs/promises'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, posix } from 'node:path'
import { AppError } from '../../shared/errors'
import { validateFileName } from './local-paths'

export type RemoteVersion = { size: number; modifiedAt: number }
type RemoteEditOptions = {
  root: string
  stat: (sessionId: string, path: string) => Promise<RemoteVersion | undefined>
  fingerprint: (sessionId: string, path: string) => Promise<string>
  download: (sessionId: string, remotePath: string, localPath: string) => Promise<void>
  upload: (
    sessionId: string,
    remotePath: string,
    localPath: string,
    targetVersion: RemoteVersion,
  ) => Promise<void>
  open: (path: string) => Promise<string>
  confirmOverwrite: (remotePath: string) => Promise<boolean>
  notify: (message: string) => void
  debounceMs?: number
}
type Edit = {
  watcher: FSWatcher
  timer?: ReturnType<typeof setTimeout>
  directory: string
  baseline: RemoteVersion
  baselineFingerprint: string
  dirty: boolean
  syncing?: boolean
  pending?: boolean
}

export class RemoteEditService {
  private edits = new Map<string, Edit>()
  private readonly debounceMs: number
  constructor(private options: RemoteEditOptions) {
    this.debounceMs = options.debounceMs ?? 700
  }

  async open(
    sessionId: string,
    remotePath: string,
    opener: (path: string) => Promise<string> = this.options.open,
  ) {
    const initial = await this.options.stat(sessionId, remotePath)
    if (!initial) throw new AppError('remote-file-missing', 'Удалённый файл не найден')
    await fs.mkdir(this.options.root, { recursive: true })
    const directory = await fs.mkdtemp(join(this.options.root, 'termlume-edit-'))
    try {
      const fileName = validateFileName(posix.basename(remotePath)),
        localPath = join(directory, basename(fileName))
      await this.options.download(sessionId, remotePath, localPath)
      const baselineFingerprint = await hashFile(localPath)
      const watcher = watch(directory, (_event, changed) => {
        if (changed && changed.toString() !== fileName) return
        const existing = this.edits.get(localPath)
        if (!existing) return
        existing.dirty = true
        if (existing.syncing) {
          existing.pending = true
          return
        }
        if (existing.timer) clearTimeout(existing.timer)
        existing.timer = setTimeout(
          () => void this.sync(sessionId, remotePath, localPath),
          this.debounceMs,
        )
      })
      this.edits.set(localPath, {
        watcher,
        directory,
        baseline: initial,
        baselineFingerprint,
        dirty: false,
      })
      const error = await opener(localPath)
      if (error) throw new AppError('open-file-failed', error)
      return { localPath }
    } catch (error) {
      for (const [localPath, edit] of this.edits)
        if (edit.directory === directory) {
          edit.watcher.close()
          this.edits.delete(localPath)
        }
      await fs.rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  private async sync(sessionId: string, remotePath: string, localPath: string) {
    const edit = this.edits.get(localPath)
    if (!edit) return
    if (edit.syncing) {
      edit.pending = true
      return
    }
    edit.syncing = true
    try {
      const remote = await this.options.stat(sessionId, remotePath)
      if (!remote) return
      const fingerprint = await this.options.fingerprint(sessionId, remotePath)
      if (
        remote.size !== edit.baseline.size ||
        remote.modifiedAt !== edit.baseline.modifiedAt ||
        fingerprint !== edit.baselineFingerprint
      ) {
        const accepted = await this.options.confirmOverwrite(remotePath)
        if (!accepted) return
      }
      const localFingerprint = await hashFile(localPath)
      await this.options.upload(sessionId, remotePath, localPath, remote)
      edit.baseline = (await this.options.stat(sessionId, remotePath)) ?? remote
      const remoteFingerprint = await this.options.fingerprint(sessionId, remotePath)
      edit.baselineFingerprint = localFingerprint
      edit.dirty = remoteFingerprint !== localFingerprint
      if (edit.dirty)
        this.options.notify(
          `Файл ${remotePath} был изменён на сервере во время сохранения. Локальная копия сохранена: ${localPath}`,
        )
    } catch (error) {
      this.options.notify(
        `Не удалось сохранить изменения ${remotePath} на сервер. Локальная копия сохранена: ${localPath}. ${String(error)}`,
      )
    } finally {
      edit.syncing = false
      if (edit.pending && this.edits.get(localPath) === edit) {
        edit.pending = false
        edit.timer = setTimeout(
          () => void this.sync(sessionId, remotePath, localPath),
          this.debounceMs,
        )
      }
    }
  }

  async close() {
    const values = [...this.edits.values()]
    this.edits.clear()
    for (const edit of values) {
      edit.watcher.close()
      if (edit.timer) clearTimeout(edit.timer)
      if (edit.dirty || edit.syncing) {
        this.options.notify(
          `Несинхронизированная копия удалённого файла оставлена в: ${edit.directory}`,
        )
      } else await fs.rm(edit.directory, { recursive: true, force: true })
    }
  }
}

async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
