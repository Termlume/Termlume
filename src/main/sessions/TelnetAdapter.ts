import { Socket } from 'node:net'
import type { HostProfile } from '../../shared/contracts'
import type { SessionAdapter } from './SessionAdapter'
import { EventAdapter } from './EventAdapter'
import { TelnetCodec } from './telnet-codec'
import { AppError } from '../../shared/errors'
export class TelnetAdapter extends EventAdapter implements SessionAdapter {
  private socket = new Socket()
  private codec: TelnetCodec
  private closed = false
  constructor(private profile: Extract<HostProfile, { protocol: 'telnet' }>) {
    super()
    this.codec = new TelnetCodec(profile.encoding)
  }
  connect(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new AppError('canceled', 'Подключение отменено'))
      const abort = () => {
        this.socket.destroy()
        reject(new AppError('canceled', 'Подключение отменено'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.socket.setTimeout(20000, () => {
        this.socket.destroy()
        reject(new AppError('timeout', 'Сервер не ответил вовремя', true))
      })
      this.socket.on('error', (error) => {
        reject(error)
        this.emit({
          type: 'error',
          error: { code: 'telnet-network', message: 'Соединение Telnet прервано', retryable: true },
        })
      })
      this.socket.on('close', () => {
        signal.removeEventListener('abort', abort)
        this.emit({ type: 'closed', reason: 'transport' })
      })
      this.socket.on('data', (chunk) => {
        try {
          const parsed = this.codec.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          parsed.replies.forEach((reply) => this.socket.write(reply))
          if (parsed.data.length) {
            const text = this.codec.decodeOutput(parsed.data)
            if (text) this.emit({ type: 'data', data: Buffer.from(text, 'utf8') })
          }
        } catch {
          this.emit({
            type: 'error',
            error: {
              code: 'telnet-protocol',
              message: 'Некорректный ответ Telnet-сервера',
              retryable: true,
            },
          })
          this.socket.destroy()
        }
      })
      this.socket.connect(this.profile.port, this.profile.host.replace(/^\[|\]$/g, ''), () => {
        this.socket.setTimeout(0)
        resolve()
      })
    })
  }
  write(data: string) {
    if (!this.closed) this.socket.write(this.codec.encodeInput(data))
  }
  resize(cols: number, rows: number) {
    const bytes = this.codec.resize(cols, rows)
    if (bytes && !this.closed) this.socket.write(bytes)
  }
  pauseOutput() {
    this.socket.pause()
  }
  resumeOutput() {
    this.socket.resume()
  }
  async close() {
    if (this.closed) return
    this.closed = true
    this.socket.destroy()
  }
}
