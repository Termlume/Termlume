export class SmoothInputQueue {
  private pending = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly send: (text: string) => void,
    private enabled: boolean,
  ) {}

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    if (!enabled) this.flush()
    this.enabled = enabled
  }

  write(text: string) {
    if (this.closed || !text) return
    if (!this.enabled) {
      this.send(text)
      return
    }
    if (/[\u0000-\u001f\u007f]/.test(text)) {
      this.flush()
      this.send(text)
      return
    }
    this.pending += text
    if (!this.timer) this.timer = setTimeout(() => this.sendNext(), 12)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.closed || !this.pending) return
    while (this.pending && !this.closed) this.sendNextChunk()
  }

  private sendNext() {
    this.timer = undefined
    if (this.closed || !this.pending) return
    this.sendNextChunk()
    if (this.pending) this.timer = setTimeout(() => this.sendNext(), 12)
  }

  private sendNextChunk() {
    const points = Array.from(this.pending),
      chunk = points.slice(0, 64).join('')
    this.pending = points.slice(64).join('')
    this.send(chunk)
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = ''
  }
}
