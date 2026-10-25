import * as pty from 'node-pty'
import { homedir } from 'node:os'
import { win32, isAbsolute } from 'node:path'
import type { LocalShellProfile } from '../../shared/contracts'
import { normalizeLocalShell } from '../../shared/local-shells'
import { AppError } from '../../shared/errors'
import { EventAdapter } from './EventAdapter'
import type { SessionAdapter } from './SessionAdapter'

type SpawnPty = typeof pty.spawn

export function localShellCommand(
  shell: LocalShellProfile['shell'],
  systemRoot = process.env.SystemRoot || 'C:\\Windows',
  platform: string = process.platform,
  environment = process.env,
) {
  shell = normalizeLocalShell(shell, platform)
  if (platform === 'linux') {
    const executable =
      shell === 'bash'
        ? '/bin/bash'
        : shell === 'zsh'
          ? '/bin/zsh'
          : environment.SHELL && isAbsolute(environment.SHELL)
            ? environment.SHELL
            : '/bin/bash'
    return { executable, args: ['-l'] }
  }
  return shell === 'powershell'
    ? {
        executable: win32.join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        args: ['-NoLogo', '-NoExit'],
      }
    : { executable: win32.join(systemRoot, 'System32', 'cmd.exe'), args: ['/Q', '/K'] }
}

export class LocalShellAdapter extends EventAdapter implements SessionAdapter {
  private term?: pty.IPty
  private ended = false
  private ready = false
  private pendingInput: string[] = []
  private readyTimer?: ReturnType<typeof setTimeout>
  private settleTimer?: ReturnType<typeof setTimeout>
  private resolveReady?: () => void
  private cols = 80
  private rows = 24

  constructor(
    private readonly shell: LocalShellProfile['shell'],
    private readonly spawnPty: SpawnPty = pty.spawn,
  ) {
    super()
  }

  async connect(signal: AbortSignal) {
    if (signal.aborted) throw new AppError('canceled', 'Запуск оболочки отменён')
    if (process.platform !== 'win32' && process.platform !== 'linux')
      throw new AppError('platform-unavailable', 'Эта платформа пока не поддерживается')
    const { executable, args } = localShellCommand(this.shell)
    this.term = this.spawnPty(executable, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    })
    const ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve
      this.readyTimer = setTimeout(() => this.markReady(), 1500)
    })
    this.term.onData((data) => {
      this.emit({ type: 'data', data: Buffer.from(data, 'utf8') })
      if (!this.ready && !this.settleTimer)
        this.settleTimer = setTimeout(() => this.markReady(), 250)
    })
    this.term.onExit(() => {
      if (this.ended) return
      this.ended = true
      this.markReady()
      this.emit({ type: 'closed', reason: 'remote-exit' })
    })
    signal.addEventListener(
      'abort',
      () => {
        void this.close()
        this.markReady()
      },
      { once: true },
    )
    await ready
  }

  write(data: string) {
    if (this.ended) return
    if (!this.ready) this.pendingInput.push(data)
    else this.term?.write(data)
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
    if (this.ended) return
    this.ended = true
    this.markReady()
    this.term?.kill()
  }

  private markReady() {
    if (this.ready) return
    this.ready = true
    if (this.readyTimer) clearTimeout(this.readyTimer)
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.readyTimer = undefined
    this.settleTimer = undefined
    this.resolveReady?.()
    this.resolveReady = undefined
    if (!this.ended) for (const data of this.pendingInput) this.term?.write(data)
    this.pendingInput = []
  }
}
