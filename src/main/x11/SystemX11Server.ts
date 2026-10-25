import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { X11Status } from '../../shared/contracts'
import type { X11Endpoint } from './bridge'
import { AppError } from '../../shared/errors'

export function systemDisplay(display: string): Omit<X11Endpoint, 'cookie'> {
  const match = /^(?:(unix|localhost|127\.0\.0\.1))?:(\d{1,4})(?:\.\d+)?$/.exec(display)
  if (!match || Number(match[2]) > 59535)
    throw new AppError('x11-display', 'X11: нужен локальный DISPLAY, например :0.')
  const number = Number(match[2])
  return match[1] && match[1] !== 'unix'
    ? { port: 6000 + number }
    : { port: 6000 + number, socketPath: `/tmp/.X11-unix/X${number}` }
}

/** Uses the desktop X server; never starts or stops a user's desktop server. */
export class SystemX11Server {
  private users = 0
  private closed = false
  async status(): Promise<X11Status> {
    try {
      const endpoint = await this.start(false)
      endpoint.cookie.fill(0)
      return {
        state: 'running',
        available: true,
        activeSessions: this.users,
        display: process.env.DISPLAY,
      }
    } catch (error) {
      return {
        state: 'stopped',
        available: false,
        activeSessions: this.users,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
  async start(_clipboard: boolean): Promise<X11Endpoint> {
    if (this.closed) throw new AppError('x11-closed', 'X11: приложение закрывается.')
    const display = process.env.DISPLAY || ''
    const endpoint = systemDisplay(display)
    let stdout: string
    try {
      const result = await promisify(execFile)('xauth', ['list', display], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 65536,
        env: process.env,
      })
      stdout = result.stdout
    } catch {
      throw new AppError(
        'x11-auth',
        'X11: недоступна авторизация системного X-сервера. Проверьте DISPLAY, XAUTHORITY и наличие xauth.',
      )
    }
    const cookie = stdout
      .split(/\r?\n/)
      .map((line) => /\sMIT-MAGIC-COOKIE-1\s+([a-f0-9]{32})\s*$/i.exec(line)?.[1])
      .find(Boolean)
    if (!cookie)
      throw new AppError('x11-auth', 'X11: системный сервер не предоставил MIT-MAGIC-COOKIE-1.')
    return { ...endpoint, cookie: Buffer.from(cookie, 'hex') }
  }
  async acquire(_autostart: boolean, clipboard: boolean) {
    const endpoint = await this.start(clipboard)
    this.users++
    let released = false
    return {
      endpoint,
      release: () => {
        if (released) return
        released = true
        this.users--
        endpoint.cookie.fill(0)
      },
    }
  }
  async stop() {
    /* The system X server belongs to the desktop session. */
  }
  async close() {
    this.closed = true
  }
}
