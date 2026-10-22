import { randomUUID } from 'node:crypto'
import type { TransferRequest, TransferSnapshot } from '../../shared/contracts'
import { AppError, safeError } from '../../shared/errors'
export type TransferJob = TransferRequest & {
  localRoot: string
  resolveCollision?: (
    target: string,
    signal: AbortSignal,
  ) => Promise<import('./collisions').CollisionChoice>
}
type Runner = (
  request: TransferJob,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
) => Promise<void>
interface Entry {
  request: TransferJob
  snapshot: TransferSnapshot
  abort: AbortController
  task?: Promise<void>
}
export class TransferQueue {
  private entries = new Map<string, Entry>()
  private listeners = new Set<(entry: TransferSnapshot) => void>()
  private stopped = new Set<string>()
  constructor(private runner: Runner) {}
  subscribe(listener: (entry: TransferSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  list() {
    return [...this.entries.values()].map((entry) => ({ ...entry.snapshot }))
  }
  get(id: string) {
    const entry = this.entries.get(id)
    if (!entry) throw new AppError('transfer-missing', 'Передача не найдена')
    return entry
  }
  async waitFor(id: string): Promise<void> {
    const initial = this.get(id)
    return new Promise((resolve, reject) => {
      let settling = false
      let off = () => {}
      const settle = async () => {
        if (settling) return
        settling = true
        const entry = this.get(id)
        await entry.task?.catch(() => {})
        off()
        if (entry.snapshot.state === 'completed') resolve()
        else if (entry.snapshot.state === 'canceled')
          reject(new AppError('canceled', 'Передача отменена'))
        else
          reject(
            new AppError(
              entry.snapshot.error?.code || 'transfer-failed',
              entry.snapshot.error?.message || 'Передача не выполнена',
              entry.snapshot.error?.retryable ?? true,
            ),
          )
      }
      const terminal = (state: TransferSnapshot['state']) =>
        state === 'completed' || state === 'failed' || state === 'canceled'
      if (terminal(initial.snapshot.state)) {
        void settle()
        return
      }
      off = this.subscribe((snapshot) => {
        if (snapshot.id === id && terminal(snapshot.state)) void settle()
      })
    })
  }
  clearCompleted(sessionId: string) {
    let removed = 0
    for (const [id, entry] of this.entries) {
      if (entry.request.sessionId === sessionId && entry.snapshot.state === 'completed') {
        this.entries.delete(id)
        removed++
      }
    }
    return removed
  }
  completedDownload(path: string) {
    const entry = [...this.entries.values()]
      .reverse()
      .find(
        (candidate) =>
          candidate.snapshot.direction === 'download' &&
          candidate.snapshot.state === 'completed' &&
          candidate.request.target === path,
      )
    if (!entry)
      throw new AppError('file-not-downloaded', 'Файл не найден среди завершённых загрузок')
    return entry
  }
  private emit(entry: Entry) {
    this.listeners.forEach((listener) => listener({ ...entry.snapshot }))
  }
  enqueue(request: TransferJob): string {
    return this.enqueueMany([request])[0]
  }
  enqueueMany(requests: TransferJob[]): string[] {
    if (!requests.length) return []
    if (requests.some((request) => this.stopped.has(request.sessionId)))
      throw new AppError('not-connected', 'Сеанс отключён. Начните передачу из нового подключения.')
    if (
      [...this.entries.values()].filter((entry) =>
        ['running', 'queued'].includes(entry.snapshot.state),
      ).length +
        requests.length >
      100
    )
      throw new AppError('queue-full', 'Очередь заполнена')
    const ids = requests.map((request) => {
      const id = randomUUID(),
        entry: Entry = {
          request: { ...request },
          snapshot: {
            id,
            sessionId: request.sessionId,
            direction: request.direction,
            source: request.source,
            target: request.target,
            state: 'queued',
            bytesDone: 0,
            bytesTotal: 0,
          },
          abort: new AbortController(),
        }
      this.entries.set(id, entry)
      this.emit(entry)
      return id
    })
    queueMicrotask(() => this.pump())
    return ids
  }
  private pump() {
    for (const entry of this.entries.values()) {
      if (entry.snapshot.state !== 'queued' || this.stopped.has(entry.request.sessionId)) continue
      if (
        [...this.entries.values()].filter(
          (other) =>
            other.request.sessionId === entry.request.sessionId &&
            other.snapshot.state === 'running',
        ).length >= 2
      )
        continue
      entry.snapshot.state = 'running'
      this.emit(entry)
      let last = 0
      entry.task = Promise.resolve()
        .then(() => {
          entry.snapshot.target = entry.request.target
          entry.abort.signal.throwIfAborted()
          return this.runner(entry.request, entry.abort.signal, (done, total) => {
            entry.snapshot.bytesDone = done
            entry.snapshot.bytesTotal = total
            if (Date.now() - last >= 100) {
              last = Date.now()
              this.emit(entry)
            }
          })
        })
        .then(() => {
          if (entry.snapshot.state === 'running') entry.snapshot.state = 'completed'
        })
        .catch((error) => {
          if (entry.snapshot.state === 'running') {
            entry.snapshot.state = 'failed'
            entry.snapshot.error = safeError(error)
            if ((error as AppError).code === 'canceled') entry.snapshot.state = 'canceled'
            entry.snapshot.conflict = (
              error as { targetVersion?: TransferSnapshot['conflict'] }
            ).targetVersion
          } else if ((error as AppError).code === 'partial-file-remains')
            entry.snapshot.error = safeError(error)
        })
        .finally(() => {
          this.emit(entry)
          this.pump()
        })
    }
    const complete = [...this.entries.values()].filter(
      (entry) => !['running', 'queued'].includes(entry.snapshot.state),
    )
    for (const entry of complete.slice(0, Math.max(0, complete.length - 200)))
      this.entries.delete(entry.snapshot.id)
  }
  async cancel(id: string) {
    const entry = this.get(id)
    if (!['running', 'queued'].includes(entry.snapshot.state)) return
    entry.snapshot.state = 'canceled'
    entry.abort.abort()
    this.emit(entry)
    await entry.task
    this.pump()
  }
  retry(id: string, overwrite = false, targetVersion?: TransferRequest['targetVersion']) {
    const entry = this.get(id)
    if (!['failed', 'canceled'].includes(entry.snapshot.state))
      throw new AppError('transfer-busy', 'Передача ещё выполняется')
    return this.enqueue({ ...entry.request, overwrite, targetVersion })
  }
  async closeSession(id: string, reason: 'disconnect' | 'user' = 'disconnect') {
    this.stopped.add(id)
    const tasks: Promise<void>[] = []
    for (const entry of this.entries.values()) {
      if (entry.request.sessionId !== id || !['running', 'queued'].includes(entry.snapshot.state))
        continue
      entry.snapshot.state =
        entry.snapshot.state === 'running' && reason === 'disconnect' ? 'failed' : 'canceled'
      entry.snapshot.error =
        reason === 'disconnect'
          ? { code: 'disconnected', message: 'Соединение разорвано', retryable: true }
          : undefined
      entry.abort.abort()
      this.emit(entry)
      if (entry.task) tasks.push(entry.task)
    }
    await Promise.all(tasks)
  }
}
