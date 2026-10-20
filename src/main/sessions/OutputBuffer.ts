export class OutputBuffer {
  private chunks: Uint8Array[] = []
  private bytes = 0
  private timer?: ReturnType<typeof setTimeout>
  private waiting?: number
  private paused = false
  private disposed = false
  private finishing?: Promise<void>
  private finishResolve?: () => void
  private finishTimer?: ReturnType<typeof setTimeout>
  constructor(
    private send: (data: Uint8Array) => number,
    private pause: () => void,
    private resume: () => void,
  ) {}
  get pendingBytes() {
    return this.bytes
  }
  push(data: Uint8Array) {
    if (this.disposed) return
    this.chunks.push(data)
    this.bytes += data.length
    if (this.bytes >= 1048576 && !this.paused) {
      this.paused = true
      this.pause()
    }
    this.schedule()
  }
  ack(sequence: number) {
    if (sequence !== this.waiting) return
    this.waiting = undefined
    this.schedule()
    if (!this.bytes) this.finishResolve?.()
  }
  private schedule() {
    if (this.disposed || this.timer || this.waiting !== undefined || !this.bytes) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, 16)
  }
  private flush() {
    if (this.disposed || !this.chunks.length) return
    const data = new Uint8Array(Math.min(this.bytes, 65536))
    let offset = 0
    while (offset < data.length) {
      const first = this.chunks[0],
        length = Math.min(first.length, data.length - offset)
      data.set(first.subarray(0, length), offset)
      offset += length
      if (length === first.length) this.chunks.shift()
      else this.chunks[0] = first.subarray(length)
    }
    this.bytes -= data.length
    this.waiting = this.send(data)
    if (this.paused && this.bytes < 524288) {
      this.paused = false
      this.resume()
    }
  }
  finish(): Promise<void> {
    if (this.finishing) return this.finishing
    if (!this.bytes && this.waiting === undefined) return Promise.resolve()
    this.finishing = new Promise((resolve) => {
      this.finishResolve = () => {
        if (this.finishTimer) clearTimeout(this.finishTimer)
        resolve()
      }
      this.finishTimer = setTimeout(() => this.finishResolve?.(), 2000)
    })
    this.schedule()
    return this.finishing
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.finishResolve?.()
    this.chunks = []
    this.bytes = 0
  }
}
