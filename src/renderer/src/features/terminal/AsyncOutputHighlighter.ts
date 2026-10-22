import type { HighlightRule } from '../../../../shared/highlight-rules'

type Batch = { text: string; acknowledgements: (() => void)[]; rules: HighlightRule[] }
export class AsyncOutputHighlighter {
  private worker: Worker | undefined
  private decoder = new TextDecoder()
  private pending: Batch | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Batch[] = []
  private running = false
  private disposed = false
  private disabled = false
  private cancelJob: (() => void) | undefined
  constructor(
    private emit: (text: string, done: () => void) => void,
    private rules: HighlightRule[],
  ) {}
  configure(rules: HighlightRule[]) {
    this.flush()
    this.rules = rules
  }
  write(bytes: Uint8Array, acknowledge: () => void) {
    if (this.disposed) return
    this.pending ??= { text: '', acknowledgements: [], rules: this.rules }
    this.pending.text += this.decoder.decode(bytes, { stream: true })
    this.pending.acknowledgements.push(acknowledge)
    if (this.pending.text.length >= 65536) this.flush()
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 16)
  }
  private flush() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending) return
    this.queue.push(this.pending)
    this.pending = undefined
    if (this.queue.reduce((size, batch) => size + batch.text.length, 0) > 1048576)
      this.disabled = true
    void this.pump()
  }
  private transform(batch: Batch): Promise<string> {
    if (this.disabled || !batch.text) return Promise.resolve(batch.text)
    return new Promise((resolve) => {
      let completed = false
      const finish = (text: string, failed = false) => {
        if (completed) return
        completed = true
        clearTimeout(timeout)
        this.cancelJob = undefined
        if (failed) {
          this.disabled = true
          this.worker?.terminate()
          this.worker = undefined
        }
        resolve(text)
      }
      // Includes worker startup; subsequent jobs use the same worker.
      const timeout = setTimeout(() => finish(batch.text, true), this.worker ? 150 : 1000)
      this.cancelJob = () => finish(batch.text, true)
      try {
        this.worker ??= new Worker(new URL('./highlight.worker.ts', import.meta.url), {
          type: 'module',
        })
        this.worker.onmessage = (event: MessageEvent<string>) => finish(event.data)
        this.worker.onerror = () => finish(batch.text, true)
        this.worker.postMessage({ text: batch.text, rules: batch.rules })
      } catch {
        finish(batch.text, true)
      }
    })
  }
  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && !this.disposed) {
        const batch = this.queue.shift()!
        const text = await this.transform(batch)
        if (this.disposed) break
        await new Promise<void>((resolve) => this.emit(text, resolve))
        for (const acknowledge of batch.acknowledgements) acknowledge()
      }
    } finally {
      this.running = false
    }
  }
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.cancelJob?.()
    this.worker?.terminate()
    this.queue = []
    this.pending = undefined
  }
}
