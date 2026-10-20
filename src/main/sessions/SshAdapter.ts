import { Client, createAgent, utils, type BaseAgent, type ClientChannel } from 'ssh2'
import { readFile, stat } from 'node:fs/promises'
import type { HostProfile, AuthAnswer, TrustAnswer, SshIdentity } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { EventAdapter } from './EventAdapter'
import type { SessionAdapter } from './SessionAdapter'
import type { KnownHostsRepository } from '../storage/KnownHostsRepository'
import { fingerprint } from '../storage/KnownHostsRepository'
import type { SecretVault } from '../storage/SecretVault'
import type { SshChallenges } from './SshChallenges'

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

  constructor(
    readonly profile: Extract<HostProfile, { protocol: 'ssh' }>,
    private options: Options,
  ) {
    super()
  }

  getClient() {
    if (!this.connected || this.closed)
      throw new AppError('not-connected', 'SSH-сеанс не подключён')
    return this.client
  }

  async connect(signal: AbortSignal): Promise<void> {
    const identity = this.options.identity
    const method = identity?.method || this.profile.auth
    const secretRef = identity?.secretRef || this.profile.secretRef
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
      if ((await stat(keyPath)).size > 1048576)
        throw new AppError('key-too-large', 'Файл ключа слишком большой')
      key = await readFile(keyPath)
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
        if (secret && this.options.remember) await this.options.remember(secret)
        return
      } catch (error) {
        if (!authenticationError(error) || attempt > 0 || method === 'agent') throw error
        if (storedSecret) {
          await this.options.clearStoredSecret?.()
          storedSecret = false
        }
        secret = await this.requestSecret(signal, method === 'key' ? 'key' : 'password')
        if (method === 'key' && key) {
          const parsed = utils.parseKey(key, secret)
          if (parsed instanceof Error)
            throw new AppError('invalid-key', 'Не удалось прочитать ключ. Проверьте passphrase.')
        }
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
      const ready = () => {
        if (this.closed || signal.aborted) return abort()
        this.client.shell(
          { term: 'xterm-256color', cols: this.cols, rows: this.rows },
          (error, channel) => {
            if (error)
              return fail(new AppError('shell-denied', 'Сервер не разрешил открыть терминал', true))
            if (this.closed || signal.aborted) {
              channel.close()
              return abort()
            }
            this.shell = channel
            this.connected = true
            channel.on('data', (data: Buffer) => this.emit({ type: 'data', data }))
            channel.stderr.on('data', (data: Buffer) => this.emit({ type: 'data', data }))
            channel.on('close', () => this.emit({ type: 'closed', reason: 'remote-exit' }))
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
        const wasConnected = this.connected
        this.connected = false
        if (wasConnected) this.emit({ type: 'closed', reason: 'transport' })
      })
      this.client.once('ready', ready)
      this.client.connect({
        host: this.profile.host.replace(/^\[|\]$/g, ''),
        port: this.profile.port,
        username: this.profile.username,
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

  write(data: string) {
    this.shell?.write(data)
  }
  resize(cols: number, rows: number) {
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
    this.shell?.close()
    this.client.destroy()
  }
}
