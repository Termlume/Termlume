import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

/** Native OLE virtual-file drag; bytes are requested only after a committed drop. */
export class WindowsDropTransfer {
  private child?: ChildProcessWithoutNullStreams
  private startup?: Promise<void>
  private closed = false
  private active?: {
    id: string
    resolve: (dropped: boolean) => void
    materialize: (signal: AbortSignal) => Promise<string>
    abort: AbortController
    pending?: Promise<void>
    failure?: Error
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  constructor(private readonly executable: string) {}

  ready(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Перенос файлов остановлен'))
    if (this.startup) return this.startup
    this.startup = new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], { windowsHide: true, stdio: 'pipe' })
      this.child = child
      const timeout = setTimeout(() => {
        fail(new Error('Помощник Windows не запустился'))
        child.kill()
      }, 10000)
      const fail = (error: Error) => {
        clearTimeout(timeout)
        reject(error)
        if (this.child !== child) return
        this.child = undefined
        this.startup = undefined
        const active = this.active
        this.active = undefined
        if (active) {
          clearTimeout(active.timer)
          active.abort.abort()
          void Promise.resolve(active.pending).then(() => active.reject(error))
        }
      }
      child.on('error', fail)
      child.stdin.on('error', fail)
      child.on('exit', () => fail(new Error('Помощник переноса Windows завершился')))
      child.stderr.resume()
      const reader = createInterface({ input: child.stdout })
      child.once('exit', () => reader.close())
      reader.on('line', (line) => {
        let message: { type?: string; id?: string; dropped?: boolean; error?: string }
        try {
          message = JSON.parse(line)
        } catch {
          fail(new Error('Некорректный ответ Windows'))
          child.kill()
          return
        }
        if (message.type === 'ready') {
          clearTimeout(timeout)
          resolve()
          return
        }
        const active = this.active
        if (!active || active.id !== message.id) return
        if (message.type === 'materialize') {
          active.pending ??= active.materialize(active.abort.signal).then(
            (path) => {
              if (!child.stdin.destroyed)
                child.stdin.write(
                  JSON.stringify({ type: 'materialized', id: active.id, path }) + '\n',
                )
            },
            (error) => {
              active.failure = error instanceof Error ? error : new Error(String(error))
              if (!child.stdin.destroyed)
                child.stdin.write(
                  JSON.stringify({
                    type: 'materialized',
                    id: active.id,
                    error: error instanceof Error ? error.message : String(error),
                  }) + '\n',
                )
            },
          )
          return
        }
        if (message.type !== 'result') return
        this.active = undefined
        clearTimeout(active.timer)
        if (message.error || !message.dropped) active.abort.abort()
        void Promise.resolve(active.pending).then(() => {
          if (active.failure) active.reject(active.failure)
          else if (message.error) active.reject(new Error(message.error))
          else active.resolve(message.dropped === true)
        })
      })
    })
    return this.startup
  }

  async drag(
    file: { name: string; sourceWindow?: string; entries?: { name: string; directory: boolean }[] },
    materialize: (signal: AbortSignal) => Promise<string>,
  ): Promise<boolean> {
    if (!file.name || /[<>:"/\\|?*\x00-\x1f]/.test(file.name))
      throw new Error('Недопустимое имя файла')
    await this.ready()
    if (this.closed || !this.child?.stdin.writable) throw new Error('Помощник переноса недоступен')
    if (this.active) throw new Error('Другой перенос ещё не завершён')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const active = this.active
        this.active = undefined
        active?.abort.abort()
        this.child?.kill()
        void Promise.resolve(active?.pending).then(() =>
          reject(new Error('Перенос отменён по времени ожидания')),
        )
      }, 7200000)
      this.active = { id, resolve, reject, timer, materialize, abort: new AbortController() }
      this.child!.stdin.write(
        JSON.stringify({
          type: 'drag',
          id,
          name: file.name,
          entries: file.entries,
          sourceWindow: file.sourceWindow,
        }) + '\n',
      )
    })
  }

  async close(): Promise<void> {
    this.closed = true
    const active = this.active
    this.active = undefined
    if (active) {
      clearTimeout(active.timer)
      active.abort.abort()
      void Promise.resolve(active.pending).then(() => active.resolve(false))
    }
    const child = this.child
    if (!child) {
      await active?.pending
      return
    }
    if (!child.stdin.destroyed) child.stdin.write('{"type":"close"}\n')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await active?.pending
  }
}
