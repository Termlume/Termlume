import * as pty from 'node-pty'
import { homedir } from 'node:os'
import type { HostProfile } from '../../shared/contracts'
import type { SessionAdapter } from './SessionAdapter'
import { EventAdapter } from './EventAdapter'
import { listWslDistributions } from '../platform/wsl'
import { AppError } from '../../shared/errors'
export class WslAdapter extends EventAdapter implements SessionAdapter {
  private term?: pty.IPty
  private ended = false
  private cols = 80
  private rows = 24
  constructor(private profile: Extract<HostProfile, { protocol: 'wsl' }>) {
    super()
  }
  async connect(signal: AbortSignal) {
    const distributions = await listWslDistributions()
    if (signal.aborted) throw new Error('aborted')
    if (!distributions.includes(this.profile.distribution))
      throw new AppError('wsl-distribution', 'Дистрибутив WSL не найден. Проверьте его имя.', true)
    this.term = pty.spawn('wsl.exe', ['--distribution', this.profile.distribution, '--cd', '~'], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
      useConptyDll: true,
    })
    this.term.onData((data) => this.emit({ type: 'data', data: Buffer.from(data, 'utf8') }))
    this.term.onExit(() => {
      this.ended = true
      this.emit({ type: 'closed', reason: 'remote-exit' })
    })
  }
  write(data: string) {
    this.term?.write(data)
  }
  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    if (!this.ended) this.term?.resize(cols, rows)
  }
  pauseOutput() {
    this.term?.pause()
  }
  resumeOutput() {
    this.term?.resume()
  }
  async close() {
    if (this.term && !this.ended) {
      this.ended = true
      this.term.kill()
    }
  }
}
