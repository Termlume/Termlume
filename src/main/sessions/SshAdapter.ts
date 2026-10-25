import { Client, createAgent, utils, type BaseAgent, type ClientChannel } from 'ssh2'
import { readFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { attachX11Bridge, type X11Endpoint } from '../x11/bridge'
import type { HostProfile, AuthAnswer, TrustAnswer, SshIdentity } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { EventAdapter } from './EventAdapter'
import type { SessionAdapter } from './SessionAdapter'
import type { KnownHostsRepository } from '../storage/KnownHostsRepository'
import { fingerprint } from '../storage/KnownHostsRepository'
import type { SecretVault } from '../storage/SecretVault'
import type { SshChallenges } from './SshChallenges'
import { expandSshKeyPath } from '../ssh/key-paths'

interface Options {
  knownHosts: KnownHostsRepository
  vault: SecretVault
  challenges: SshChallenges
  ownerId: number
  sessionId: string
  identity?: SshIdentity
  initialSecret?: string
  remember?: (value: string) => Promise<void>
  clearStoredSecret?: () => Promise<void>
  fileReady?: () => Promise<unknown>
  x11?: () => Promise<{ endpoint: X11Endpoint; release: () => void }>
  notice?: (message: string) => void
}

function authenticationError(error: unknown) {
  return error instanceof AppError && error.code === 'ssh-auth'
}

function filterAgent(identity: SshIdentity | undefined, agent: BaseAgent): BaseAgent {
  if (!identity?.agentFingerprint) return agent
  const scoped = Object.create(agent) as BaseAgent
  scoped.getIdentities = (callback) =>
    agent.getIdentities((error, keys) => {
      if (error || !keys) return callback(error, keys)
      callback(
        error,
        keys.filter((entry) => {
          const raw =
            typeof entry === 'object' && entry !== null && 'pubKey' in entry ? entry.pubKey : entry
          const candidate =
            typeof raw === 'object' && raw !== null && 'pubKey' in raw ? raw.pubKey : raw
          const publicKey =
            typeof candidate === 'object' && candidate !== null && 'getPublicSSH' in candidate
              ? (candidate as { getPublicSSH(): Buffer }).getPublicSSH()
              : (() => {
                  const parsed = utils.parseKey(candidate as string | Buffer)
                  return parsed instanceof Error || Array.isArray(parsed)
                    ? undefined
                    : parsed.getPublicSSH()
                })()
          return !!publicKey && fingerprint(publicKey) === identity.agentFingerprint
        }),
      )
    })
  scoped.sign = agent.sign.bind(agent)
  return scoped
}

export class SshAdapter extends EventAdapter implements SessionAdapter {
  private client = new Client()
  private shell?: ClientChannel
  private cols = 80
  private rows = 24
  private connected = false
  private closed = false
  private rememberSecret = true
  private closeX11?: () => void

  constructor(
    readonly profile: Extract<HostProfile, { protocol: 'ssh' | 'sftp' }>,
    private options: Options,
  ) {
    super()
  }

  getClient() {
    if (!this.connected || this.closed)
      throw new AppError('not-connected', 'SSH-сеанс не подключён')
    return this.client
  }

  get cwdUsername() {
    return this.options.identity?.username || this.profile.username
  }

  async connect(signal: AbortSignal): Promise<void> {
    const identity: SshIdentity | undefined =
      this.options.identity ||
      (this.profile.agentEndpoint
        ? {
            id: this.profile.id,
            name: this.profile.name,
            method: 'agent',
            agentEndpoint: this.profile.agentEndpoint,
            agentFingerprint: this.profile.agentFingerprint,
          }
        : undefined)
    const method = identity?.method || this.profile.auth
    const secretRef = identity ? identity.secretRef : this.profile.secretRef
    let secret = this.options.initialSecret
    this.options.initialSecret = undefined
    let storedSecret = false
    if (!secret && secretRef) {
      try {
        secret = await this.options.vault.get(secretRef)
        storedSecret = !!secret
      } catch (error) {
        if ((error as AppError).code !== 'secret-unavailable') throw error
      }
    }

    let key: Buffer | undefined
    const keyPath = identity?.keyPath || this.profile.keyPath
    if (method === 'key') {
      if (!keyPath) throw new AppError('key-missing', 'Укажите приватный ключ')
      const resolvedKeyPath = expandSshKeyPath(keyPath)
      let keyStat
      try {
        keyStat = await stat(resolvedKeyPath)
      } catch {
        throw new AppError(
          'key-unavailable',
          'Приватный ключ не найден или недоступен. Проверьте путь к файлу.',
        )
      }
      if (!keyStat.isFile())
        throw new AppError('invalid-key', 'Выберите файл приватного ключа, а не папку.')
      if (keyStat.size > 1048576) throw new AppError('key-too-large', 'Файл ключа слишком большой')
      try {
        key = await readFile(resolvedKeyPath)
      } catch {
        throw new AppError(
          'key-unavailable',
          'Не удалось прочитать приватный ключ. Проверьте права доступа к файлу.',
        )
      }
      let parsed = utils.parseKey(key, secret)
      if (parsed instanceof Error && /encrypted|passphrase|decrypt/i.test(parsed.message)) {
        if (secret && storedSecret) {
          await this.options.clearStoredSecret?.()
          storedSecret = false
          secret = undefined
        }
        secret = await this.requestSecret(signal, 'key')
        parsed = utils.parseKey(key, secret)
      }
      if (parsed instanceof Error)
        throw new AppError(
          'invalid-key',
          'Не удалось прочитать ключ. Проверьте формат и passphrase.',
        )
      if (Array.isArray(parsed) || !parsed.isPrivateKey())
        throw new AppError(
          'invalid-key',
          'Выбран публичный ключ. Укажите приватный ключ — файл без расширения .pub.',
        )
    }

    let agent: BaseAgent | undefined
    if (method === 'agent') {
      const endpoint =
        identity?.agentEndpoint ||
        process.env.SSH_AUTH_SOCK ||
        (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
      if (!endpoint) throw new AppError('agent-unavailable', 'SSH-агент не обнаружен')
      try {
        agent = filterAgent(identity, createAgent(endpoint))
      } catch {
        throw new AppError('agent-unavailable', 'Не удалось подключиться к SSH-агенту')
      }
    }

    if (method === 'password' && !secret) secret = await this.requestSecret(signal, 'password')
    if (signal.aborted || this.closed) throw new AppError('canceled', 'Подключение отменено')

    for (let attempt = 0; ; attempt++) {
      try {
        await this.connectOnce(signal, { method, secret, key, agent })
        if (secret && this.rememberSecret && this.options.remember)
          await this.options.remember(secret)
        return
      } catch (error) {
        // A parsed private key is already unlocked; server rejection is not a passphrase error.
        if (!authenticationError(error) || attempt > 0 || method !== 'password') throw error
        if (storedSecret) {
          await this.options.clearStoredSecret?.()
          storedSecret = false
        }
        secret = await this.requestSecret(signal, 'password')
      }
    }
  }

  private async requestSecret(signal: AbortSignal, type: 'password' | 'key') {
    const answer = (await this.options.challenges.request(
      this.options.ownerId,
      this.options.sessionId,
      {
        kind: 'auth',
        host: this.profile.host,
        canRemember: !!this.options.remember,
        authType: type,
      },
      signal,
      (event) => this.emit(event),
    )) as AuthAnswer
    this.rememberSecret = answer.remember
    const secret = type === 'key' ? answer.passphrase : answer.password
    if (!secret) throw new AppError('auth-required', 'Введите секрет для аутентификации')
    return secret
  }

  private connectOnce(
    signal: AbortSignal,
    auth: { method: SshIdentity['method']; secret?: string; key?: Buffer; agent?: BaseAgent },
  ) {
    this.client = new Client()
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(error)
        this.client.destroy()
      }
      const abort = () => fail(new AppError('canceled', 'Подключение отменено'))
      const ready = async () => {
        if (this.closed || signal.aborted) return abort()
        if (this.profile.protocol === 'sftp') {
          this.connected = true
          void Promise.resolve(this.options.fileReady?.()).then(() => {
            if (this.closed || signal.aborted) return abort()
            settled = true
            signal.removeEventListener('abort', abort)
            resolve()
          }, fail)
          return
        }
        let x11: { cookie: Buffer; single: boolean } | undefined
        if (this.profile.protocol === 'ssh' && this.profile.x11Forwarding) {
          try {
            if (!this.options.x11) throw new Error('X11: локальный X-сервер недоступен.')
            const hasXauth = await this.remoteHasXauth()
            if (!hasXauth)
              throw new Error(
                'X11: на SSH-сервере не найден xauth или запрещена его проверка. Проверьте пакет xauth и переподключитесь.',
              )
            const lease = await this.options.x11()
            if (this.closed || signal.aborted) {
              lease.release()
              return abort()
            }
            x11 = { cookie: randomBytes(16), single: false }
            const detach = attachX11Bridge(this.client, x11.cookie, lease.endpoint, (message) =>
              this.x11Notice(message),
            )
            this.closeX11 = () => {
              detach()
              lease.release()
              this.closeX11 = undefined
            }
          } catch (error) {
            this.x11Notice(
              error instanceof Error ? error.message : 'X11: не удалось запустить X-сервер.',
            )
          }
        }
        if (this.closed || signal.aborted) {
          this.closeX11?.()
          return abort()
        }
        const openShell = (forwarding: typeof x11) =>
          this.client.shell(
            { term: 'xterm-256color', cols: this.cols, rows: this.rows },
            forwarding ? { x11: forwarding } : {},
            (error, channel) => {
              if (error && forwarding) {
                this.closeX11?.()
                this.x11Notice(
                  'X11: сервер отклонил forwarding. Проверьте X11Forwarding yes и XAuthLocation в sshd_config; терминал открыт без X11.',
                )
                openShell(undefined)
                return
              }
              if (error)
                return fail(
                  new AppError('shell-denied', 'Сервер не разрешил открыть терминал', true),
                )
              if (this.closed || signal.aborted) {
                channel.close()
                return abort()
              }
              this.shell = channel
              this.connected = true
              channel.on('data', (data: Buffer) => this.emit({ type: 'data', data }))
              channel.stderr.on('data', (data: Buffer) => this.emit({ type: 'data', data }))
              channel.on('close', () => {
                this.closeX11?.()
                this.emit({ type: 'closed', reason: 'remote-exit' })
              })
              channel.on('error', () =>
                this.emit({
                  type: 'error',
                  error: {
                    code: 'shell-error',
                    message: 'Терминальный канал закрыт',
                    retryable: true,
                  },
                }),
              )
              settled = true
              signal.removeEventListener('abort', abort)
              resolve()
            },
          )
        openShell(x11)
      }
      signal.addEventListener('abort', abort, { once: true })
      this.client.on('error', (error) => {
        if (settled) {
          if (this.connected)
            this.emit({
              type: 'error',
              error: { code: 'ssh-network', message: 'Соединение SSH прервано', retryable: true },
            })
          return
        }
        const authFailed = /authentication/i.test(error.message)
        const message = authFailed
          ? 'Сервер отклонил аутентификацию'
          : /timed out|timeout/i.test(error.message)
            ? 'Сервер не ответил вовремя'
            : /handshake|algorithm/i.test(error.message)
              ? 'Не удалось согласовать алгоритмы SSH'
              : 'Соединение SSH прервано'
        fail(new AppError(authFailed ? 'ssh-auth' : 'ssh-connect', message, true))
      })
      this.client.on('close', () => {
        this.closeX11?.()
        const wasConnected = this.connected
        this.connected = false
        if (wasConnected) this.emit({ type: 'closed', reason: 'transport' })
      })
      this.client.once('ready', () => {
        void ready().catch(fail)
      })
      this.client.connect({
        host: this.profile.host.replace(/^\[|\]$/g, ''),
        port: this.profile.port,
        username: this.options.identity?.username || this.profile.username,
        password: auth.method === 'password' ? auth.secret : undefined,
        privateKey: auth.method === 'key' ? auth.key : undefined,
        passphrase: auth.method === 'key' ? auth.secret : undefined,
        agent: auth.method === 'agent' ? auth.agent : undefined,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          void (async () => {
            const known = await this.options.knownHosts.check(
              this.profile.host,
              this.profile.port,
              key,
            )
            if (signal.aborted || this.closed) return verify(false)
            if (known === 'match') return verify(true)
            const algorithm =
              key.length >= 4
                ? key.subarray(4, Math.min(4 + key.readUInt32BE(0), key.length)).toString('ascii')
                : 'SSH'
            const answer = (await this.options.challenges.request(
              this.options.ownerId,
              this.options.sessionId,
              {
                kind: 'trust',
                host: this.profile.host + ':' + this.profile.port,
                fingerprint: fingerprint(key),
                algorithm,
                changed: known === 'changed',
              },
              signal,
              (event) => this.emit(event),
            )) as TrustAnswer
            if (!answer.accept || (known === 'changed' && !answer.replaceExisting)) {
              verify(false)
              return fail(new AppError('host-key-rejected', 'Ключ сервера не подтверждён'))
            }
            if (signal.aborted || this.closed) return verify(false)
            await this.options.knownHosts.trust(this.profile.host, this.profile.port, key)
            verify(true)
          })().catch((error) => {
            verify(false)
            fail(error)
          })
        },
      })
    })
  }

  private requireTerminal() {
    if (this.profile.protocol === 'sftp')
      throw new AppError('terminal-unsupported', 'Файловый сеанс не имеет терминала')
  }
  private x11Notice(message: string) {
    this.options.notice?.(message)
    this.emit({ type: 'data', data: Buffer.from(`\r\n[${message}]\r\n`) })
  }
  private remoteHasXauth(): Promise<boolean> {
    return new Promise((resolve) => {
      let channel: ClientChannel | undefined,
        settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        channel?.close()
        resolve(value)
      }
      const timeout = setTimeout(() => finish(false), 5000)
      this.client.exec('command -v xauth >/dev/null 2>&1', (error, stream) => {
        if (error || settled) {
          stream?.close()
          return finish(false)
        }
        channel = stream
        stream.on('data', () => {})
        stream.stderr.on('data', () => {})
        stream.once('exit', (code) => finish(code === 0))
        stream.once('close', () => finish(false))
        stream.once('error', () => finish(false))
      })
    })
  }
  write(data: string) {
    this.requireTerminal()
    this.shell?.write(data)
  }
  resize(cols: number, rows: number) {
    this.requireTerminal()
    this.cols = cols
    this.rows = rows
    this.shell?.setWindow(rows, cols, 0, 0)
  }
  pauseOutput() {
    this.shell?.pause()
    this.shell?.stderr.pause()
  }
  resumeOutput() {
    this.shell?.resume()
    this.shell?.stderr.resume()
  }
  async close() {
    if (this.closed) return
    this.closed = true
    this.connected = false
    this.closeX11?.()
    this.shell?.close()
    this.client.destroy()
  }
}
