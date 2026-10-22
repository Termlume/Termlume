import { spawn, type ChildProcess } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { connect } from 'node:net'
import type { X11Status } from '../../shared/contracts'
import { createNativeCookie, xauthority, x11Setup } from './auth'
import type { X11Endpoint } from './bridge'
import { AppError } from '../../shared/errors'

function probe(port: number, cookie?: Buffer): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (error?: Error, accepted = false) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(accepted)
    }
    socket.setTimeout(1000, () => done(new Error('X11 readiness timeout')))
    socket.once('connect', () => socket.write(x11Setup(cookie)))
    socket.once('data', (data) => done(undefined, data[0] === 1))
    socket.once('error', (error) => done(error))
    socket.once('end', () => done())
  })
}

export class X11Server {
  private child?: ChildProcess
  private endpoint?: X11Endpoint
  private cookie?: Buffer
  private directory?: string
  private starting?: Promise<X11Endpoint>
  private stopping?: Promise<void>
  private closed = false
  private state: X11Status['state'] = 'stopped'
  private message?: string
  private users = 0
  constructor(private executable: string) {}

  async status(): Promise<X11Status> {
    const available = await access(this.executable).then(
      () => true,
      () => false,
    )
    return {
      state: this.state,
      available,
      activeSessions: this.users,
      message: this.message,
      display: this.endpoint ? `127.0.0.1:${this.endpoint.port - 6000}.0` : undefined,
    }
  }

  async acquire(autostart: boolean, clipboard: boolean) {
    if (!this.endpoint && !autostart)
      throw new AppError(
        'x11-not-running',
        'X11: запустите X-сервер в настройках или включите автозапуск.',
      )
    const endpoint = await this.start(clipboard)
    this.users++
    let released = false
    return {
      endpoint,
      release: () => {
        if (!released) {
          released = true
          this.users--
        }
      },
    }
  }

  async start(clipboard: boolean): Promise<X11Endpoint> {
    if (this.closed) throw new AppError('x11-closed', 'X11: приложение закрывается.')
    if (this.stopping) await this.stopping
    if (this.endpoint) return this.endpoint
    if (this.starting) return this.starting
    this.state = 'starting'
    this.message = undefined
    this.starting = (async () => {
      if (this.directory || this.child) await this.terminate()
      if (this.closed) throw new AppError('x11-closed', 'X11: приложение закрывается.')
      return this.launch(clipboard)
    })()
      .catch(async (error) => {
        this.state = 'error'
        this.message = error instanceof Error ? error.message : String(error)
        await this.terminate()
        throw new AppError('x11-start', this.message, true)
      })
      .finally(() => {
        this.starting = undefined
      })
    return this.starting
  }

  private async launch(clipboard: boolean) {
    if (process.platform !== 'win32') throw new Error('Встроенный X-сервер доступен в Windows.')
    await access(this.executable).catch(() => {
      throw new Error(
        'X11: VcXsrv отсутствует. Выполните npm run prepare:x11 для локальной сборки.',
      )
    })
    const display = randomInt(100, 400)
    const cookie = (this.cookie = createNativeCookie())
    this.directory = await mkdtemp(join(tmpdir(), 'termlume-x11-'))
    const auth = join(this.directory, 'Xauthority')
    await writeFile(auth, xauthority(cookie, display), { mode: 0o600 })
    const child = (this.child = spawn(
      this.executable,
      [
        `:${display}`,
        '-multiwindow',
        '-auth',
        auth,
        '-listen',
        'tcp',
        '-nolisten',
        'inet6',
        '-noreset',
        '-nowgl',
        '-notrayicon',
        clipboard ? '-clipboard' : '-noclipboard',
        '-logfile',
        join(this.directory, 'server.log'),
      ],
      { cwd: dirname(this.executable), windowsHide: true, stdio: 'ignore' },
    ))
    let launchError: Error | undefined
    child.once('error', (error) => {
      launchError = error
    })
    child.once('exit', () => {
      if (this.child !== child) return
      this.cookie?.fill(0)
      this.cookie = undefined
      this.endpoint = undefined
      this.state = 'error'
      this.message = 'X11: локальный X-сервер завершился. Переподключите SSH-сеанс.'
    })
    const port = 6000 + display
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      if (child.exitCode !== null)
        throw new Error(
          'X11: VcXsrv не запустился. Проверьте доступность дисплея и разрешение Windows.',
        )
      const authenticated = await probe(port, cookie).catch(() => false)
      if (authenticated) {
        if (await probe(port))
          throw new Error('X11: X-сервер разрешил подключение без cookie; запуск заблокирован.')
        if (this.closed) throw new Error('X11: приложение закрывается.')
        this.endpoint = { port, cookie }
        this.state = 'running'
        return this.endpoint
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))),
      )
    }
    cookie.fill(0)
    throw new Error('X11: X-сервер не подтвердил защищённый запуск за 5 секунд.')
  }

  private async terminate() {
    const child = this.child
    this.child = undefined
    this.cookie?.fill(0)
    this.cookie = undefined
    this.endpoint = undefined
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.kill()
      })
    }
    if (this.directory) await rm(this.directory, { force: true, recursive: true }).catch(() => {})
    this.directory = undefined
  }

  async stop() {
    if (this.users)
      throw new AppError('x11-in-use', 'X11 используется SSH-сеансами. Сначала отключите их.')
    if (this.starting) await this.starting.catch(() => {})
    if (this.users)
      throw new AppError('x11-in-use', 'X11 используется SSH-сеансами. Сначала отключите их.')
    this.stopping = this.terminate().finally(() => {
      this.state = 'stopped'
      this.message = undefined
      this.stopping = undefined
    })
    await this.stopping
  }
  async close() {
    this.closed = true
    if (this.starting) await this.starting.catch(() => {})
    await this.terminate()
  }
}
