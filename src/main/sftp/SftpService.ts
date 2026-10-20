import type { Client, SFTPWrapper, Stats } from 'ssh2'
import type { FileEntry } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
export function sftpCall<T>(
  invoke: (callback: (error: Error | undefined | null, value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new AppError('sftp-timeout', 'SFTP не ответил вовремя', true)),
      15000,
    )
    try {
      invoke((error, value) => {
        clearTimeout(timeout)
        if (error)
          reject(
            new AppError(
              'sftp-operation',
              'Операция SFTP отклонена: проверьте путь и права доступа',
              true,
            ),
          )
        else resolve(value)
      })
    } catch (error) {
      clearTimeout(timeout)
      reject(error)
    }
  })
}
export function classifySftpOpenError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Unable to start subsystem: sftp')
    return new AppError('sftp-unsupported', 'Сервер не предоставляет SFTP subsystem', true)
  return new AppError('sftp-unavailable', message || 'SFTP недоступен на этом сервере', true)
}
export class SftpService {
  private channels = new Map<string, { promise: Promise<SFTPWrapper>; canceled: boolean }>()
  constructor(private client: (id: string) => Client) {}
  get(id: string): Promise<SFTPWrapper> {
    const existing = this.channels.get(id)
    if (existing) return existing.promise
    const entry = { promise: undefined as unknown as Promise<SFTPWrapper>, canceled: false }
    entry.promise = new Promise<SFTPWrapper>((resolve, reject) => {
      const timeout = setTimeout(() => {
        entry.canceled = true
        this.channels.delete(id)
        reject(new AppError('sftp-unavailable', 'Сервер не ответил на открытие SFTP', true))
      }, 10000)
      try {
        this.client(id).sftp((error, channel) => {
          clearTimeout(timeout)
          if (error) {
            this.channels.delete(id)
            return reject(classifySftpOpenError(error))
          }
          if (entry.canceled) {
            channel.end()
            return reject(new AppError('canceled', 'SFTP-сеанс закрыт'))
          }
          channel.on('error', () => {})
          channel.once('close', () => {
            if (this.channels.get(id) === entry) this.channels.delete(id)
          })
          resolve(channel)
        })
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
    this.channels.set(id, entry)
    return entry.promise
  }
  async realpath(id: string, path: string): Promise<string> {
    const channel = await this.get(id)
    return sftpCall((callback) => channel.realpath(path, callback))
  }
  async stat(id: string, path: string): Promise<Stats> {
    const channel = await this.get(id)
    return sftpCall<Stats>((callback) => channel.stat(path, callback))
  }
  async lstat(id: string, path: string): Promise<Stats> {
    const channel = await this.get(id)
    return sftpCall<Stats>((callback) => channel.lstat(path, callback))
  }
  async statOptional(id: string, path: string): Promise<Stats | undefined> {
    const channel = await this.get(id)
    return new Promise((resolve, reject) =>
      channel.lstat(path, (error, stat) => {
        if (!error) resolve(stat)
        else if ((error as Error & { code?: number }).code === 2) resolve(undefined)
        else reject(new AppError('sftp-stat', 'Не удалось проверить удалённый файл', true))
      }),
    )
  }
  async list(id: string, path: string): Promise<FileEntry[]> {
    const channel = await this.get(id)
    const entries = await sftpCall<import('ssh2').FileEntryWithStats[]>((callback) =>
      channel.readdir(path, callback),
    )
    return entries
      .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
      .map((entry) => ({
        name: entry.filename,
        type: entry.attrs.isSymbolicLink()
          ? 'symlink'
          : entry.attrs.isDirectory()
            ? 'directory'
            : 'file',
        size: entry.attrs.size,
        modifiedAt: entry.attrs.mtime * 1000,
        isSymlink: entry.attrs.isSymbolicLink(),
        permissions: entry.attrs.mode & 0o7777,
        owner: String(entry.attrs.uid),
        group: String(entry.attrs.gid),
      }))
  }
  async mkdir(id: string, path: string) {
    const channel = await this.get(id)
    await sftpCall<void>((callback) => channel.mkdir(path, callback))
  }
  async chmod(id: string, path: string, mode: number) {
    const channel = await this.get(id)
    await sftpCall<void>((callback) => channel.chmod(path, mode, callback))
  }
  async chown(id: string, path: string, uid: number, gid: number) {
    const channel = await this.get(id)
    await sftpCall<void>((callback) => channel.chown(path, uid, gid, callback))
  }
  async rename(id: string, from: string, to: string) {
    const channel = await this.get(id)
    const exists = await new Promise<boolean>((resolve) =>
      channel.lstat(to, (error) => resolve(!error)),
    )
    if (exists) throw new AppError('exists', 'Файл с таким именем уже существует')
    await sftpCall<void>((callback) => channel.rename(from, to, callback))
  }
  async remove(id: string, path: string, type: 'file' | 'empty-directory') {
    const channel = await this.get(id)
    await sftpCall<void>((callback) =>
      type === 'file' ? channel.unlink(path, callback) : channel.rmdir(path, callback),
    )
  }
  async close(id: string) {
    const entry = this.channels.get(id)
    if (!entry) return
    entry.canceled = true
    this.channels.delete(id)
    entry.promise.then((channel) => channel.end()).catch(() => {})
  }
}
