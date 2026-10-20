import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Client, ClientChannel } from 'ssh2'
import { AppError } from '../../shared/errors'
import type { FileEntry } from '../../shared/contracts'

export function quotePosixShellPath(path: string): string {
  if (!path || path.includes('\0')) throw new AppError('unsafe-path', 'Недопустимый путь')
  return `'${path.replace(/'/g, `'"'"'`)}'`
}
function requireUtility(error: unknown, utility: string): never {
  if (
    (error as AppError)?.code === 'scp-command' &&
    new RegExp(
      `${utility}.*(?:not found|not recognized|unrecognized|invalid option|unknown option|unknown predicate)`,
      'i',
    ).test((error as Error).message)
  )
    throw new AppError(
      'scp-capability',
      `Сервер не поддерживает команду ${utility}, необходимую для файлового браузера`,
      true,
    )
  throw error
}

class ChannelReader {
  private buffer = Buffer.alloc(0)
  private waiters: (() => void)[] = []
  private error?: Error
  constructor(channel: ClientChannel) {
    channel.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.wake()
    })
    channel.once('error', (error: Error) => {
      this.error = error
      this.wake()
    })
    channel.once('close', () => {
      if (!this.error)
        this.error = new AppError(
          'scp-closed',
          'Соединение SCP было закрыто до завершения передачи',
          true,
        )
      this.wake()
    })
  }
  private wake() {
    this.waiters.splice(0).forEach((wake) => wake())
  }
  private async fill(length: number) {
    while (this.buffer.length < length) {
      if (this.error) throw this.error
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
  async exact(length: number): Promise<Buffer> {
    await this.fill(length)
    const value = this.buffer.subarray(0, length)
    this.buffer = this.buffer.subarray(length)
    return value
  }
  async line(max = 4096): Promise<string> {
    while (true) {
      const end = this.buffer.indexOf(10)
      if (end >= 0) {
        const value = this.buffer.subarray(0, end).toString('utf8')
        this.buffer = this.buffer.subarray(end + 1)
        return value
      }
      if (this.buffer.length > max) throw new AppError('scp-protocol', 'Ответ SCP слишком длинный')
      await this.fill(this.buffer.length + 1)
    }
  }
}

async function write(channel: ClientChannel, value: Buffer | string, signal?: AbortSignal) {
  if (!channel.write(value))
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        channel.removeListener('drain', onDrain)
        channel.removeListener('close', onClose)
        channel.removeListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const finish = (error?: Error) => {
        cleanup()
        error ? reject(error) : resolve()
      }
      const onDrain = () => finish()
      const onClose = () => finish(new AppError('scp-closed', 'Соединение SCP было закрыто', true))
      const onError = (error: Error) => finish(error)
      const onAbort = () => finish(new AppError('aborted', 'Передача отменена'))
      channel.once('drain', onDrain)
      channel.once('close', onClose)
      channel.once('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
}
async function ack(reader: ChannelReader, channel: ClientChannel) {
  const status = (await reader.exact(1))[0]
  if (status === 0) return
  const detail = status === 1 || status === 2 ? await reader.line() : 'Неизвестный ответ SCP'
  throw new AppError('scp-rejected', `SCP отклонил операцию: ${detail}`, true)
}

export class ScpService {
  private principalNames = new Map<string, Promise<string>>()
  constructor(private client: (id: string) => Client) {}
  private async open(id: string, command: string, signal?: AbortSignal): Promise<ClientChannel> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let settled = false
      let openedChannel: ClientChannel | undefined
      const removeAbortListener = () => signal?.removeEventListener('abort', onAbort)
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        removeAbortListener()
        reject(error)
      }
      const onAbort = () => {
        openedChannel?.close()
        rejectOnce(
          signal?.reason instanceof Error
            ? signal.reason
            : new AppError('aborted', 'Передача отменена'),
        )
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        this.client(id).exec(command, { pty: false }, (error, channel) => {
          if (error || !channel) {
            rejectOnce(new AppError('scp-unavailable', 'Не удалось открыть SCP канал', true))
            return
          }
          openedChannel = channel
          if (settled || signal?.aborted) {
            channel.close()
            if (!settled)
              rejectOnce(
                signal?.reason instanceof Error
                  ? signal.reason
                  : new AppError('aborted', 'Передача отменена'),
              )
            return
          }
          channel.once('close', removeAbortListener)
          channel.on('error', () => {})
          settled = true
          resolve(channel)
        })
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
  private async command(id: string, command: string): Promise<Buffer> {
    const channel = await this.open(id, command)
    const stdout: Buffer[] = [],
      stderr: Buffer[] = []
    let exitCode = 0
    channel.once('exit', (code: number | null) => {
      exitCode = code ?? 1
    })
    channel.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)))
    channel.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        channel.close()
        reject(new AppError('scp-timeout', 'SCP-команда не ответила вовремя', true))
      }, 15000)
      channel.once('error', (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      })
      channel.once('close', (code?: number) => {
        clearTimeout(timeout)
        if ((code !== undefined && code !== 0) || exitCode !== 0)
          reject(
            new AppError(
              'scp-command',
              Buffer.concat(stderr).toString('utf8').trim() ||
                'Не удалось выполнить операцию на сервере',
              true,
            ),
          )
        else resolve(Buffer.concat(stdout))
      })
    })
  }
  async list(id: string, path: string): Promise<FileEntry[]> {
    const command = `LC_ALL=C find ${quotePosixShellPath(path)} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0%s\\0%T@\\0%m\\0%u\\0%g\\0'`
    const output = await this.command(id, command).catch((error) => requireUtility(error, 'find')),
      parts = output.toString('utf8').split('\0')
    if (parts.at(-1) === '') parts.pop()
    if (parts.length % 7 !== 0)
      throw new AppError('scp-capability', 'Сервер не поддерживает безопасный вывод списка файлов')
    const entries: FileEntry[] = []
    for (let index = 0; index < parts.length; index += 7) {
      const [name, type, sizeText, modifiedText, modeText, owner, group] = parts.slice(
        index,
        index + 7,
      )
      const size = Number(sizeText),
        modified = Number(modifiedText),
        permissions = Number.parseInt(modeText, 8)
      if (
        !name ||
        !['f', 'd', 'l'].includes(type) ||
        !Number.isFinite(size) ||
        !Number.isFinite(modified) ||
        !Number.isFinite(permissions)
      )
        throw new AppError('scp-capability', 'Сервер вернул некорректный список файлов')
      entries.push({
        name,
        type: type === 'd' ? 'directory' : type === 'l' ? 'symlink' : 'file',
        size,
        modifiedAt: modified * 1000,
        isSymlink: type === 'l',
        permissions,
        owner,
        group,
      })
    }
    return entries
  }
  async resolvePrincipal(id: string, database: 'passwd' | 'group', value: string | undefined) {
    if (!value || !/^\d+$/.test(value)) return value
    const key = `${id}:${database}:${value}`
    let name = this.principalNames.get(key)
    if (!name) {
      name = this.command(id, `getent ${database} ${value}`)
        .then((result) => result.toString('utf8').split(':', 1)[0]?.trim() || value)
        .catch(() => value)
      this.principalNames.set(key, name)
    }
    return name
  }
  async resolvePrincipalId(id: string, database: 'passwd' | 'group', value: string): Promise<number> {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value)
      if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff) return numeric
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value))
      throw new AppError('invalid-principal', 'Недопустимое имя владельца или группы')
    const output = await this.command(id, `getent ${database} ${quotePosixShellPath(value)}`)
    const fields = output.toString('utf8').trim().split(':')
    if (fields.length < 3 || fields[0] !== value || !/^\d+$/.test(fields[2]))
      throw new AppError('principal-not-found', 'Не удалось найти владельца или группу на сервере')
    const numeric = Number(fields[2])
    if (!Number.isSafeInteger(numeric) || numeric > 0xffffffff)
      throw new AppError('invalid-principal', 'Сервер вернул недопустимый номер владельца или группы')
    return numeric
  }
  async stat(id: string, path: string) {
    const output = await this.command(
      id,
      `if [ -e ${quotePosixShellPath(path)} ] || [ -L ${quotePosixShellPath(path)} ]; then LC_ALL=C find ${quotePosixShellPath(path)} -maxdepth 0 -printf '%y\\0%s\\0%T@\\0%m\\0'; fi`,
    ).catch((error) => requireUtility(error, 'find'))
    if (!output.length) return undefined
    const [type, sizeText, modifiedText, modeText] = output.toString('utf8').split('\0')
    const size = Number(sizeText),
      modified = Number(modifiedText),
      permissions = Number.parseInt(modeText, 8)
    if (
      !['f', 'd', 'l'].includes(type) ||
      !Number.isFinite(size) ||
      !Number.isFinite(modified) ||
      !Number.isFinite(permissions)
    )
      throw new AppError('scp-stat', 'Не удалось проверить удалённый файл', true)
    return {
      isFile: () => type === 'f',
      isDirectory: () => type === 'd',
      isSymbolicLink: () => type === 'l',
      size,
      mtime: Math.floor(modified),
      mode: permissions,
    }
  }
  async get(
    id: string,
    remotePath: string,
    localPath: string,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ) {
    signal.throwIfAborted()
    const channel = await this.open(id, `scp -f -- ${quotePosixShellPath(remotePath)}`, signal),
      reader = new ChannelReader(channel)
    const temp = join(dirname(localPath), `.${basename(localPath)}.${randomUUID()}.part`)
    try {
      await write(channel, Buffer.from([0]), signal)
      const header = await reader.line()
      const match = /^C([0-7]{4}) (\d+) (.*)$/.exec(header)
      if (!match)
        throw new AppError(
          'scp-protocol',
          `Сервер прислал неподдерживаемый ответ: ${header.slice(0, 100)}`,
        )
      const total = Number(match[2])
      if (match[3] !== basename(remotePath) || /[\r\n]/.test(match[3]))
        throw new AppError('scp-protocol', 'Сервер прислал имя файла, не совпадающее с запросом')
      if (!Number.isSafeInteger(total))
        throw new AppError('scp-protocol', 'Некорректный размер файла')
      await write(channel, Buffer.from([0]), signal)
      const output = fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 })
      let outputError: Error | undefined
      const outputFailed = new Promise<never>((_resolve, reject) => {
        output.once('error', (error: Error) => {
          outputError = error
          reject(error)
        })
      })
      void outputFailed.catch(() => {})
      let done = 0
      try {
        while (done < total) {
          signal.throwIfAborted()
          const chunk = await Promise.race([
            reader.exact(Math.min(64 * 1024, total - done)),
            outputFailed,
          ])
          if (outputError) throw outputError
          if (!output.write(chunk))
            await Promise.race([
              new Promise<void>((resolve) => output.once('drain', resolve)),
              outputFailed,
            ])
          if (outputError) throw outputError
          done += chunk.length
          progress(done, total)
        }
        await Promise.race([
          new Promise<void>((resolve, reject) =>
            output.end((error?: Error | null) => (error ? reject(error) : resolve())),
          ),
          outputFailed,
        ])
      } catch (error) {
        output.destroy()
        throw error
      }
      const end = await reader.exact(1)
      if (end[0] !== 0) throw new AppError('scp-protocol', 'Передача SCP завершилась с ошибкой')
      await write(channel, Buffer.from([0]), signal)
      signal.throwIfAborted()
      await fsp.rename(temp, localPath)
      progress(total, total)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {})
      throw error
    } finally {
      channel.close()
    }
  }
  async put(
    id: string,
    localPath: string,
    remotePath: string,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ) {
    signal.throwIfAborted()
    const stat = await fsp.stat(localPath)
    if (!stat.isFile())
      throw new AppError('regular-file-only', 'Передавать можно только обычные файлы')
    const channel = await this.open(id, `scp -t -- ${quotePosixShellPath(remotePath)}`, signal),
      reader = new ChannelReader(channel)
    try {
      await ack(reader, channel)
      const fileName = basename(remotePath)
      if (/[\r\n\0]/.test(fileName))
        throw new AppError('scp-capability', 'SCP не поддерживает имя файла с переводом строки')
      await write(channel, `C0644 ${stat.size} ${fileName}\n`, signal)
      await ack(reader, channel)
      let done = 0
      for await (const chunk of fs.createReadStream(localPath)) {
        signal.throwIfAborted()
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        await write(channel, data, signal)
        done += data.length
        progress(done, stat.size)
      }
      await write(channel, Buffer.from([0]), signal)
      await ack(reader, channel)
      progress(stat.size, stat.size)
    } finally {
      channel.close()
    }
  }
  async mutate(
    id: string,
    operation: 'mkdir' | 'rename' | 'remove' | 'chmod' | 'chown',
    path: string,
    name?: string,
    permissions?: number,
    overwrite = false,
    owner?: string,
    group?: string,
  ) {
    const quoted = quotePosixShellPath(path)
    let command: string
    if (operation === 'mkdir') command = `mkdir -- ${quoted}`
    else if (operation === 'chown') {
      if (!owner || !group) throw new AppError('invalid-principal', 'Укажите владельца и группу')
      const [uid, gid] = await Promise.all([
        this.resolvePrincipalId(id, 'passwd', owner),
        this.resolvePrincipalId(id, 'group', group),
      ])
      command = `chown ${uid}:${gid} -- ${quoted}`
    } else if (operation === 'chmod') {
      if (!Number.isInteger(permissions) || permissions! < 0 || permissions! > 0o7777)
        throw new AppError('invalid-permissions', 'Недопустимые права файла')
      command = `chmod ${permissions!.toString(8)} -- ${quoted}`
    } else if (operation === 'remove')
      command = `${name === 'empty-directory' ? 'rmdir' : 'rm -f'} -- ${quoted}`
    else {
      if (!name || name.includes('/') || name.includes('\\'))
        throw new AppError('unsafe-name', 'Недопустимое имя файла')
      const destination = posix.join(posix.dirname(path), name)
      if (!overwrite && (await this.stat(id, destination)))
        throw new AppError('exists', 'Файл с таким именем уже существует')
      command = `mv ${overwrite ? '-f' : '-n'} -- ${quoted} ${quotePosixShellPath(destination)}`
      await this.command(id, command)
      if (!overwrite && (await this.stat(id, path)))
        throw new AppError('exists', 'Файл с таким именем уже существует')
      return
    }
    await this.command(id, command)
  }
  async realpath(id: string, path: string): Promise<string> {
    const output = await this.command(id, `readlink -f -- ${quotePosixShellPath(path)}`).catch(
      (error) => requireUtility(error, 'readlink'),
    )
    const resolved = output.toString('utf8').trim()
    if (!resolved.startsWith('/'))
      throw new AppError('scp-capability', 'Сервер не вернул абсолютный путь')
    return resolved
  }
}
