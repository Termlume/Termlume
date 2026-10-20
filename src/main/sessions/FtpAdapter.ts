import { Client } from 'basic-ftp'
import type { AuthAnswer, HostProfile } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import type { SecretVault } from '../storage/SecretVault'
import { EventAdapter } from './EventAdapter'
import type { SessionAdapter } from './SessionAdapter'
import type { SshChallenges } from './SshChallenges'

const deferredCleanup = new Map<string, Map<string, boolean>>()

export class FtpAdapter extends EventAdapter implements SessionAdapter {
  private client = new Client(20000)
  private tail: Promise<unknown> = Promise.resolve()
  private connected = false
  private closed = false
  constructor(
    readonly profile: Extract<HostProfile, { protocol: 'ftp' }>,
    private options: {
      vault: SecretVault
      challenges: SshChallenges
      ownerId: number
      sessionId: string
      initialSecret?: string
      remember?: (secret: string) => Promise<void>
      clearStoredSecret?: () => Promise<void>
    },
  ) {
    super()
  }

  private cleanupKey() {
    return JSON.stringify([
      this.profile.host,
      this.profile.port,
      this.profile.username,
      this.profile.security,
    ])
  }
  deferCleanup(path: string, directory = false) {
    const key = this.cleanupKey()
    let paths = deferredCleanup.get(key)
    if (!paths) {
      paths = new Map()
      deferredCleanup.set(key, paths)
    }
    paths.set(path, directory)
    return () => {
      paths!.delete(path)
      if (!paths!.size) deferredCleanup.delete(key)
    }
  }
  async connect(signal: AbortSignal) {
    let password = this.options.initialSecret
    this.options.initialSecret = undefined
    if (!password && this.profile.secretRef) {
      try {
        password = await this.options.vault.get(this.profile.secretRef)
      } catch (error) {
        if ((error as AppError).code !== 'secret-unavailable') throw error
      }
    }
    let rememberSecret = true
    const prompt = async () => {
      const answer = (await this.options.challenges.request(
        this.options.ownerId,
        this.options.sessionId,
        {
          kind: 'auth',
          host: this.profile.host,
          canRemember: !!this.options.remember,
          authType: 'password',
        },
        signal,
        (event) => this.emit(event),
      )) as AuthAnswer
      rememberSecret = answer.remember
      if (!answer.password) throw new AppError('auth-required', 'Введите пароль FTP')
      return answer.password
    }
    if (!password) password = await prompt()
    const abort = () => this.client.close()
    signal.addEventListener('abort', abort, { once: true })
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted()
        if (this.closed) throw new AppError('canceled', 'Подключение отменено')
        try {
          await this.client.access({
            host: this.profile.host.replace(/^\[|\]$/g, ''),
            port: this.profile.port,
            user: this.profile.username,
            password,
            secure:
              this.profile.security === 'implicit-tls'
                ? 'implicit'
                : this.profile.security === 'explicit-tls',
            secureOptions: { rejectUnauthorized: true },
          })
          break
        } catch (error) {
          if ((error as { code?: number }).code !== 530 || attempt > 0) throw error
          await this.options.clearStoredSecret?.()
          password = await prompt()
        }
      }
      signal.throwIfAborted()
      const pending = deferredCleanup.get(this.cleanupKey())
      if (pending)
        for (const [path, directory] of pending) {
          try {
            if (directory) await this.client.removeDir(path)
            else await this.client.remove(path, true)
            pending.delete(path)
          } catch {
            /* Retry only application-owned temporary paths on the next login. */
          }
        }
      if (!pending?.size) deferredCleanup.delete(this.cleanupKey())
      this.connected = true
      this.client.ftp.socket.once('close', () => {
        if (this.connected && !this.closed) {
          this.connected = false
          this.emit({ type: 'closed', reason: 'transport' })
        }
      })
      if (rememberSecret) await this.options.remember?.(password)
    } catch (error) {
      this.client.close()
      throw new AppError(
        'ftp-connect',
        signal.aborted
          ? 'Подключение отменено'
          : 'Не удалось подключиться к FTP. Проверьте адрес, пароль и сертификат.',
        true,
      )
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  run<T>(operation: (client: Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const task = this.tail.then(async () => {
      signal?.throwIfAborted()
      if (!this.connected || this.closed || this.client.closed)
        throw new AppError('not-connected', 'FTP-сеанс не подключён')
      const abort = () => {
        this.client.close()
        this.connected = false
        this.emit({ type: 'closed', reason: 'transport' })
      }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        return await operation(this.client)
      } catch (error) {
        if (this.client.closed && this.connected) {
          this.connected = false
          this.emit({ type: 'closed', reason: 'transport' })
        }
        if (typeof (error as { code?: unknown }).code === 'number')
          throw new AppError(
            'ftp-operation',
            'Сервер FTP отклонил операцию: проверьте путь и права доступа',
            true,
          )
        throw error
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    })
    this.tail = task.catch(() => {})
    return task
  }
  write() {
    throw new AppError('terminal-unsupported', 'Файловый сеанс не имеет терминала')
  }
  resize() {
    throw new AppError('terminal-unsupported', 'Файловый сеанс не имеет терминала')
  }
  pauseOutput() {}
  resumeOutput() {}
  async close() {
    this.closed = true
    this.connected = false
    this.client.close()
    await this.tail
  }
}
