import { basename, dirname, join, posix, win32 } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell, screen } from 'electron'
import { LocalFilesService } from './sftp/LocalFilesService'
import { sshKeyPickerDirectory } from './ssh/key-paths'
import { SftpService } from './sftp/SftpService'
import { ScpService } from './sftp/ScpService'
import { RemoteFileAccess } from './sftp/RemoteFileAccess'
import { ExternalDragService } from './sftp/ExternalDragService'
import { LinuxDragService } from './sftp/LinuxDragService'
import { LazyDragTree } from './sftp/LazyDragTree'
import { RemoteDragProvider } from './sftp/RemoteDragProvider'
import { WindowsDropTransfer } from './sftp/WindowsDropTransfer'
import { RemoteEditService } from './sftp/RemoteEditService'
import { openFile } from './sftp/FileOpener'
import { ensureLocalPath, validateFileName } from './sftp/local-paths'
import { TransferQueue } from './sftp/TransferQueue'
import { MonitoringService } from './monitoring/MonitoringService'
import { execText } from './monitoring/exec-text'
import { execWslText } from './monitoring/exec-wsl'
import { CloseCoordinator, type CloseSummary } from './lifecycle/close-coordinator'
import { HostRepository } from './storage/HostRepository'
import { SettingsRepository } from './storage/SettingsRepository'
import { KnownHostsRepository } from './storage/KnownHostsRepository'
import { IdentityRepository } from './storage/IdentityRepository'
import {
  removeCredentialLinks,
  secretReferenceIsShared,
  sameCredentialBinding,
} from './storage/credential-management'
import { SecretVault } from './storage/SecretVault'
import { DataImportTransaction } from './storage/DataImportTransaction'
import {
  decodePortableBackup,
  encodePortableBackup,
  type PortableData,
} from './storage/portable-backup'
import { systemSecrets } from './platform/system-secrets'
import type { Request } from '../shared/schemas'
import { localShellLabels, normalizeLocalShell } from '../shared/local-shells'
import { AppError } from '../shared/errors'
import { SessionManager } from './sessions/SessionManager'
import { SessionJournal } from './logs/SessionJournal'
import { WslAdapter } from './sessions/WslAdapter'
import { FtpAdapter } from './sessions/FtpAdapter'
import { FtpFileAccess } from './sftp/FtpFileAccess'
import { SshAdapter } from './sessions/SshAdapter'
import { SystemX11Server } from './x11/SystemX11Server'
import { X11Server } from './x11/X11Server'
import { SshChallenges } from './sessions/SshChallenges'
import { TelnetAdapter } from './sessions/TelnetAdapter'
import { LocalShellAdapter } from './sessions/LocalShellAdapter'
import { discoverSshIdentities } from './ssh/discover-identities'
import { listWslDistributions, listWslInventory, wslRoot } from './platform/wsl'
import { wslHomeDirectory } from './platform/wsl-home'
import { WslFileAccess } from './sftp/WslFileAccess'
import type {
  SessionEvent,
  TransferSnapshot,
  MetricSnapshot,
  FileDragRequest,
  FileActivity,
} from '../shared/contracts'
function isRemoteFileProtocol(protocol: string) {
  return protocol === 'ssh' || protocol === 'sftp' || protocol === 'ftp'
}
export class Backend {
  readonly hosts: HostRepository
  readonly settings: SettingsRepository
  readonly knownHosts: KnownHostsRepository
  readonly identities: IdentityRepository
  readonly vault: SecretVault
  readonly sessions: SessionManager
  readonly journal: SessionJournal
  readonly temporarySecrets = new Map<string, string | undefined>()
  readonly challenges = new SshChallenges()
  readonly x11 =
    process.platform === 'linux'
      ? new SystemX11Server()
      : new X11Server(
          app.isPackaged
            ? join(process.resourcesPath, 'x11', 'vcxsrv.exe')
            : join(app.getAppPath(), 'build', 'x11', 'vcxsrv.exe'),
        )
  readonly sftp: SftpService
  readonly remoteFiles: RemoteFileAccess
  readonly externalDrag: ExternalDragService
  private readonly linuxDrag =
    process.platform === 'linux'
      ? new LinuxDragService(
          app.isPackaged
            ? join(process.resourcesPath, 'native', 'termlume-file-drag')
            : join(app.getAppPath(), 'native/linux-drag/bin/termlume-file-drag'),
          join(app.getPath('temp'), 'termlume-drag-' + process.pid),
        )
      : undefined
  private readonly nativeDrag = new WindowsDropTransfer(
    app.isPackaged
      ? join(process.resourcesPath, 'native', 'Termlume.FileDrag.exe')
      : join(app.getAppPath(), 'native', 'windows-drag', 'bin', 'Termlume.FileDrag.exe'),
  )
  private readonly dragDirectories = new Set<string>()
  private readonly downloadDirectories = new Set<string>()
  private readonly collisionChoices = new Map<string, import('./sftp/collisions').CollisionChoice>()
  private collisionPrompt: Promise<unknown> = Promise.resolve()
  readonly remoteEdits: RemoteEditService
  readonly transfers: TransferQueue
  readonly monitoring: MonitoringService
  readonly localFiles = new LocalFilesService(app.getPath('home'))
  readonly wslFiles = new WslFileAccess()
  readonly closer: CloseCoordinator
  private closing = false
  private closePromise?: Promise<void>
  private storageMutations = 0
  private sessionUsernames = new Map<string, string>()
  private dataImportInProgress = false
  private pendingImports = new Map<string, PortableData>()
  constructor(
    root: string,
    readonly ownerId: number,
    emit: (event: SessionEvent) => void,
    emitTransfer: (entry: TransferSnapshot) => void = () => {},
    emitMetric: (event: { sessionId: string; snapshot: MetricSnapshot }) => void = () => {},
    private notice: (message: string) => void = () => {},
    confirmClose: (summary: CloseSummary) => Promise<boolean> = async () => false,
    private readonly fileActivity: (activity: FileActivity) => void = () => {},
  ) {
    if (process.platform === 'win32') void this.nativeDrag.ready().catch(() => {})
    this.hosts = new HostRepository(join(root, 'hosts.json'))
    this.settings = new SettingsRepository(join(root, 'settings.json'))
    this.knownHosts = new KnownHostsRepository(join(root, 'known-hosts.json'))
    this.identities = new IdentityRepository(join(root, 'identities.json'))
    this.vault = new SecretVault(join(root, 'secrets.json'), systemSecrets)
    this.journal = new SessionJournal(root, (message) => this.notice(message))
    this.sessions = new SessionManager(
      async (profile, id) => {
        if (profile.protocol === 'local') return new LocalShellAdapter(profile.shell)
        const temporary = this.temporarySecrets.has(profile.id),
          initialSecret = this.temporarySecrets.get(profile.id)
        this.temporarySecrets.delete(profile.id)
        if (profile.protocol === 'wsl') return new WslAdapter(profile)
        if (profile.protocol === 'telnet') return new TelnetAdapter(profile)
        if (
          profile.protocol === 'ssh' ||
          profile.protocol === 'sftp' ||
          profile.protocol === 'ftp'
        ) {
          let identity =
            !temporary && 'identityId' in profile && profile.identityId
              ? (await this.identities.list()).find((value) => value.id === profile.identityId)
              : undefined
          // Legacy identities sometimes kept the protected secret reference only on their host.
          if (identity && !identity.username && !identity.secretRef && profile.secretRef)
            identity = await this.identities.save({ ...identity, secretRef: profile.secretRef })
          let reference = identity
            ? identity.secretRef || identity.id
            : profile.secretRef || profile.id
          let expectedBinding:
            import('../shared/contracts').HostProfile | import('../shared/contracts').SshIdentity =
            identity || profile
          const readBinding = async () =>
            identity
              ? (await this.identities.list()).find((item) => item.id === identity?.id)
              : (await this.hosts.list()).find((item) => item.id === profile.id)
          const remember = temporary
            ? undefined
            : async (value: string) => {
                try {
                  const current = await readBinding()
                  if (!current || !sameCredentialBinding(expectedBinding, current)) return
                  if (
                    secretReferenceIsShared(
                      reference,
                      identity ? { identityId: identity.id } : { hostId: profile.id },
                      await this.hosts.list(),
                      await this.identities.list(),
                    )
                  )
                    reference = randomUUID()
                  await this.vault.set(reference, value)
                  expectedBinding = identity
                    ? await this.identities.save({
                        ...current,
                        secretRef: reference,
                      } as import('../shared/contracts').SshIdentity)
                    : await this.hosts.save({
                        ...current,
                        secretRef: reference,
                      } as import('../shared/contracts').HostProfile)
                } catch {
                  this.notice(
                    'Не удалось сохранить секрет в защищённом системном хранилище. Введите его снова при следующем подключении.',
                  )
                }
              }
          const clearStoredSecret = async () => {
            const current = await readBinding()
            if (!current || !sameCredentialBinding(expectedBinding, current)) return
            if (
              !secretReferenceIsShared(
                reference,
                identity ? { identityId: identity.id } : { hostId: profile.id },
                await this.hosts.list(),
                await this.identities.list(),
              )
            )
              await this.vault.remove(reference)
            expectedBinding = identity
              ? await this.identities.save({
                  ...current,
                  secretRef: undefined,
                } as import('../shared/contracts').SshIdentity)
              : await this.hosts.save({
                  ...current,
                  secretRef: undefined,
                } as import('../shared/contracts').HostProfile)
          }
          const options = {
            knownHosts: this.knownHosts,
            vault: this.vault,
            challenges: this.challenges,
            ownerId: this.ownerId,
            sessionId: id,
            identity,
            initialSecret,
            remember,
            clearStoredSecret,
            notice: (message: string) => this.notice(message),
            x11: async () => {
              const settings = await this.settings.get()
              return this.x11.acquire(settings.x11Autostart ?? true, settings.x11Clipboard ?? true)
            },
            fileReady: profile.protocol === 'sftp' ? () => this.sftp.get(id) : undefined,
          }
          this.sessionUsernames.set(id, identity?.username || profile.username)
          return profile.protocol === 'ftp'
            ? new FtpAdapter(profile, options)
            : new SshAdapter(profile, options)
        }
        throw new AppError('protocol-unavailable', 'Протокол недоступен')
      },
      (_owner, event) => {
        if (event.type === 'state' && event.state === 'connected') {
          const username = this.sessionUsernames.get(event.sessionId)
          if (username) void this.settings.update({ lastUsername: username }).catch(() => {})
        }
        if (
          event.type === 'closed' ||
          (event.type === 'state' && ['error', 'disconnected'].includes(event.state))
        ) {
          this.sessionUsernames.delete(event.sessionId)
          this.monitoring?.closeSession(event.sessionId)
          void this.transfers?.closeSession(event.sessionId)
          void this.linuxDrag?.closeSession(event.sessionId)
          void this.sftp?.close(event.sessionId)
          this.remoteFiles?.close(event.sessionId)
          void this.remoteEdits?.closeSession(event.sessionId).catch(() => {})
        }
        emit(event)
      },
      {
        open: (id, profile) =>
          profile.protocol === 'sftp' || profile.protocol === 'ftp'
            ? Promise.resolve()
            : this.journal.autoStart(id, 'id' in profile ? profile.id : '', profile.name),
        output: (id, data) => this.journal.output(id, data),
        close: (id) => this.journal.stop(id),
      },
    )
    this.sftp = new SftpService((id) => this.ssh(id).getClient())
    this.remoteFiles = new RemoteFileAccess(
      this.sftp,
      new ScpService((id) => this.ssh(id).getClient()),
      (id) => this.sessions.get(this.ownerId, id).profile.protocol === 'sftp',
      {
        matches: (id) => this.sessions.get(this.ownerId, id).profile.protocol === 'ftp',
        provider: new FtpFileAccess((id) => {
          const adapter = this.sessions.get(this.ownerId, id).adapter
          if (!(adapter instanceof FtpAdapter))
            throw new AppError('ftp-required', 'Нужно FTP-подключение')
          return adapter
        }),
      },
    )
    this.transfers = new TransferQueue(async (request, signal, progress) => {
      let applyAll: import('./sftp/collisions').CollisionChoice | undefined
      request.resolveCollision = async (target, abort) => {
        const prompt = this.collisionPrompt.then(async () => {
          abort.throwIfAborted()
          if (request.batchId && this.collisionChoices.has(request.batchId))
            return this.collisionChoices.get(request.batchId)!
          if (applyAll) return applyAll
          const result = await dialog.showMessageBox({
            type: 'question',
            title: 'Файл уже существует',
            message: target,
            detail: 'Папки объединяются. Выберите действие для совпадающих файлов.',
            buttons: ['Заменить', 'Пропустить', 'Сохранить оба', 'Отменить передачу'],
            cancelId: 3,
            defaultId: 1,
            checkboxLabel: 'Применить ко всем файлам этой передачи',
          })
          abort.throwIfAborted()
          const choice =
            (['replace', 'skip', 'keep-both', 'cancel'] as const)[result.response] || 'cancel'
          if (result.checkboxChecked) {
            applyAll = choice
            if (request.batchId) {
              this.collisionChoices.set(request.batchId, choice)
              if (this.collisionChoices.size > 200)
                this.collisionChoices.delete(this.collisionChoices.keys().next().value!)
            }
          }
          return choice
        })
        this.collisionPrompt = prompt.catch(() => {})
        return prompt
      }
      const profile = this.sessions.get(this.ownerId, request.sessionId).profile
      if (profile.protocol === 'wsl')
        return this.wslFiles.transfer(
          await wslRoot(profile.distribution),
          request,
          signal,
          progress,
        )
      if (profile.protocol === 'local')
        return this.wslFiles.transfer(this.localFiles.root, request, signal, progress)
      if (!['ssh', 'sftp', 'ftp'].includes(profile.protocol))
        throw new AppError('files-unsupported', 'Для Telnet передача файлов не поддерживается')
      return this.remoteFiles.transfer(request, signal, progress)
    })
    this.transfers.subscribe((snapshot) => {
      emitTransfer(snapshot)
      if (snapshot.direction === 'download')
        this.fileActivity({
          sessionId: snapshot.sessionId,
          path: snapshot.source,
          kind: 'download',
          state:
            snapshot.state === 'completed' || snapshot.state === 'canceled'
              ? 'done'
              : snapshot.state === 'failed'
                ? 'error'
                : 'running',
          completed: snapshot.bytesDone,
          total: snapshot.bytesTotal || undefined,
          error: snapshot.error?.message,
        })
    })
    this.externalDrag = new ExternalDragService(
      join(root, 'temp', 'external-drag'),
      this.remoteFiles,
      app.isPackaged
        ? join(process.resourcesPath, 'drag-icon.ico')
        : join(app.getAppPath(), 'build', 'icon.ico'),
      async (request, signal) => {
        const id = this.transfers.enqueue(request),
          cancel = () => void this.transfers.cancel(id)
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await this.transfers.waitFor(id)
        } finally {
          signal.removeEventListener('abort', cancel)
        }
      },
    )
    this.remoteEdits = new RemoteEditService({
      root: join(app.getPath('userData'), 'remote-edits'),
      stat: async (sessionId, remotePath) => {
        const stat = await this.remoteFiles.stat(sessionId, remotePath)
        return stat ? { size: stat.size, modifiedAt: stat.mtime * 1000 } : undefined
      },
      fingerprint: async (sessionId, remotePath) => {
        const directory = await fs.mkdtemp(join(app.getPath('temp'), 'termlume-fingerprint-')),
          target = join(directory, 'remote-file')
        try {
          await this.remoteFiles.transfer(
            {
              sessionId,
              direction: 'download',
              source: remotePath,
              target,
              overwrite: false,
              localRoot: directory,
            },
            new AbortController().signal,
            () => {},
          )
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(target)) hash.update(chunk)
          return hash.digest('hex')
        } finally {
          await fs.rm(directory, { recursive: true, force: true })
        }
      },
      download: async (sessionId, remotePath, localPath) => {
        this.fileActivity({
          sessionId,
          path: remotePath,
          kind: 'open',
          state: 'running',
          completed: 0,
        })
        const controller = new AbortController()
        await this.remoteFiles.transfer(
          {
            sessionId,
            direction: 'download',
            source: remotePath,
            target: localPath,
            overwrite: false,
            localRoot: dirname(localPath),
          },
          controller.signal,
          (completed, total) =>
            this.fileActivity({
              sessionId,
              path: remotePath,
              kind: 'open',
              state: 'running',
              completed,
              total,
            }),
        )
      },
      upload: async (sessionId, remotePath, localPath, targetVersion) => {
        const controller = new AbortController()
        await this.remoteFiles.transfer(
          {
            sessionId,
            direction: 'upload',
            source: localPath,
            target: remotePath,
            overwrite: true,
            targetVersion,
            localRoot: dirname(localPath),
          },
          controller.signal,
          () => {},
        )
      },
      open: (path) => shell.openPath(path),
      confirmOverwrite: async (remotePath) => {
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Удалённый файл изменён',
          message: `Файл ${remotePath} изменился на сервере после открытия. Перезаписать его локальной версией?`,
          buttons: ['Перезаписать', 'Оставить серверную версию'],
          defaultId: 1,
          cancelId: 1,
        })
        return result.response === 0
      },
      notify: (message) => this.notice(message),
    })
    this.monitoring = new MonitoringService(
      (id) => ({
        profile: (() => {
          const profile = this.sessions.get(this.ownerId, id).profile
          if (profile.protocol === 'local')
            throw new AppError('monitor-disabled', 'Для локальной оболочки мониторинг недоступен')
          return profile
        })(),
        exec: (command, signal) => {
          const profile = this.sessions.get(this.ownerId, id).profile
          return profile.protocol === 'wsl'
            ? execWslText(profile.distribution, command, signal)
            : execText(this.ssh(id).getClient(), command, signal)
        },
      }),
      (sessionId, snapshot) => emitMetric({ sessionId, snapshot }),
    )
    this.closer = new CloseCoordinator(
      (_owner, id) => ({
        sessions: this.sessions
          .list(this.ownerId)
          .filter((entry) => entry.connected && (!id || entry.id === id)).length,
        transfers: this.transfers
          .list()
          .filter(
            (entry) =>
              ['running', 'queued'].includes(entry.state) && (!id || entry.sessionId === id),
          ).length,
      }),
      confirmClose,
      () => this.close(),
      async (_owner, id) => {
        await Promise.all([
          this.transfers.closeSession(id, 'user'),
          this.sessions.close(this.ownerId, id),
          this.sftp.close(id),
        ])
      },
    )
  }
  ssh(id: string): SshAdapter {
    const adapter = this.sessions.get(this.ownerId, id).adapter
    if (!(adapter instanceof SshAdapter))
      throw new AppError('ssh-required', 'Для этой операции нужно SSH-подключение')
    return adapter
  }
  private requireFileSession(id: string) {
    const session = this.sessions.get(this.ownerId, id)
    if (!session.connected) throw new AppError('not-connected', 'Сеанс не подключён')
    const profile = session.profile
    if (profile.protocol === 'ssh' || profile.protocol === 'sftp') this.ssh(id).getClient()
    else if (profile.protocol === 'ftp') {
      /* ownership and connection checked above */
    } else if (profile.protocol !== 'wsl' && profile.protocol !== 'local')
      throw new AppError(
        'files-unsupported',
        'Telnet не поддерживает передачу файлов: у него нет файлового канала.',
      )
    return profile
  }
  async beginExternalDrag(request: FileDragRequest, sender: Electron.WebContents) {
    this.ensureActive()
    if (process.platform === 'linux') {
      const profile = this.requireFileSession(request.sessionId)
      let path: string
      if (request.phase === 'start' && profile.protocol !== 'local') {
        if (!request.token || !this.linuxDrag?.owns(request.sessionId, request.token))
          throw new AppError('drag-expired', 'Перенос завершён. Перетащите файл ещё раз.')
        path = request.token
      } else if (profile.protocol === 'local')
        path = await ensureLocalPath(this.localFiles.root, request.path)
      else {
        if (!this.linuxDrag?.available())
          throw new AppError('drag-unavailable', 'Для переноса нужен FUSE3 (пакет fuse3)')
        const original = await this.remoteFiles.lstat(request.sessionId, request.path)
        if (
          !original ||
          original.isSymbolicLink() ||
          (!original.isFile() && !original.isDirectory())
        )
          throw new AppError(
            'unsafe-link',
            'Перенос поддерживает обычные файлы и папки без символических ссылок',
          )
        const canonical = await this.remoteFiles.realpath(request.sessionId, request.path)
        let rangeReader: SftpService | undefined
        if (profile.protocol !== 'ftp') {
          try {
            await this.sftp.get(request.sessionId)
            rangeReader = this.sftp
          } catch (error) {
            if ((error as AppError).code !== 'sftp-unsupported') throw error
          }
        }
        const provider = new RemoteDragProvider(
          request.sessionId,
          this.remoteFiles,
          rangeReader,
          join(app.getPath('temp'), 'termlume-drag-' + process.pid, 'cache'),
        )
        const tree = new LazyDragTree(
          canonical,
          {
            directory: original.isDirectory(),
            size: original.size,
            modifiedAt: original.mtime * 1000,
          },
          provider,
        )
        try {
          path = await this.linuxDrag.prepare(request.sessionId, tree)
        } catch (error) {
          await tree.close()
          throw error
        }
      }
      if (request.phase === 'prepare') return path
      if (sender.isDestroyed()) return false
      sender.startDrag({
        file: path,
        icon: app.isPackaged
          ? join(process.resourcesPath, 'drag-icon.png')
          : join(app.getAppPath(), 'build/icon.png'),
      })
      return path
    }
    if (process.platform !== 'win32')
      throw new AppError(
        'drag-unavailable',
        'Перенос из сервера в файловый менеджер Linux пока недоступен. Используйте «Скачать в…».',
      )
    const profile = this.requireFileSession(request.sessionId)
    const name = validateFileName(
      isRemoteFileProtocol(profile.protocol)
        ? posix.basename(request.path)
        : win32.basename(request.path),
    )
    const descriptors: { name: string; directory: boolean }[] = []
    const remote = isRemoteFileProtocol(profile.protocol)
    const localRoot = remote
      ? undefined
      : profile.protocol === 'wsl'
        ? await wslRoot(profile.distribution)
        : this.localFiles.root
    const describe = async (path: string, relative: string, depth: number): Promise<void> => {
      if (depth > 128 || descriptors.length >= 100000 || relative.length > 259)
        throw new AppError('directory-limit', 'Папка превышает ограничения переноса Windows')
      const nativePath =
        profile.protocol === 'wsl'
          ? await this.wslFiles.accessiblePath(localRoot!, path, true)
          : path
      const stat = remote
        ? await this.remoteFiles.lstat(request.sessionId, path)
        : await fs.lstat(
            profile.protocol === 'wsl' ? nativePath : await ensureLocalPath(localRoot!, path),
          )
      if (!stat || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new AppError(
          'unsafe-link',
          'Перенос поддерживает обычные файлы и папки без символических ссылок',
        )
      descriptors.push({ name: relative, directory: stat.isDirectory() })
      if (!stat.isDirectory()) return
      const names = remote
        ? (await this.remoteFiles.list(request.sessionId, path)).entries.map((entry) => entry.name)
        : await fs.readdir(nativePath)
      for (const child of names) {
        validateFileName(child)
        await describe(
          remote ? posix.join(path, child) : join(path, child),
          relative + '\\' + child,
          depth + 1,
        )
      }
    }
    await describe(request.path, name, 0)
    /* Metadata only: file bytes remain deferred until the native drop commits. */
    const source = BrowserWindow.fromWebContents(sender)
    if (!source || source.isDestroyed()) return false
    const bounds = source.getBounds(),
      cursor = screen.getCursorScreenPoint()
    if (
      cursor.x >= bounds.x &&
      cursor.y >= bounds.y &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y < bounds.y + bounds.height
    )
      return false
    const handle = source.getNativeWindowHandle()
    const sourceWindow =
      handle?.length === 8
        ? handle.readBigUInt64LE().toString(16)
        : handle?.readUInt32LE().toString(16)
    let directory: string | undefined
    try {
      return await this.nativeDrag.drag(
        { name, sourceWindow, entries: descriptors },
        async (signal) => {
          signal.throwIfAborted()
          this.requireFileSession(request.sessionId)
          directory = await fs.mkdtemp(join(app.getPath('temp'), 'termlume-drop-'))
          this.dragDirectories.add(directory)
          signal.throwIfAborted()
          const target = join(directory, name)
          const id = this.transfers.enqueue({
            sessionId: request.sessionId,
            direction: 'download',
            source: request.path,
            target,
            overwrite: false,
            localRoot: directory,
          })
          const abort = () => {
            void this.transfers.cancel(id).catch(() => {})
          }
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          try {
            await this.transfers.waitFor(id)
            signal.throwIfAborted()
            return target
          } finally {
            signal.removeEventListener('abort', abort)
          }
        },
      )
    } finally {
      if (directory) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
        this.dragDirectories.delete(directory)
      }
    }
  }

  private ensureActive() {
    if (this.closing) throw new AppError('closing', 'Приложение завершает работу')
  }
  private async withStorageMutation<T>(action: () => Promise<T>): Promise<T> {
    this.storageMutations++
    try {
      return await action()
    } finally {
      this.storageMutations--
    }
  }
  async handle(request: Request): Promise<unknown> {
    this.ensureActive()
    if (this.dataImportInProgress)
      throw new AppError(
        'import-in-progress',
        'Импорт выполняется. Повторите действие через несколько секунд.',
      )
    switch (request.action) {
      case 'app.openUrl':
        return shell.openExternal(request.url)
      case 'logs.settings':
        return this.journal.settings()
      case 'logs.configure':
        return this.journal.configure(request.patch)
      case 'logs.list':
        return this.journal.list()
      case 'logs.read':
        return this.journal.read(request.id)
      case 'logs.bookmark':
        return this.journal.bookmark(request.id, request.bookmarked)
      case 'logs.start': {
        const profile = this.sessions.get(this.ownerId, request.sessionId).profile
        if (profile.protocol === 'sftp' || profile.protocol === 'ftp')
          throw new Error('У этого сеанса нет терминала')
        return this.journal.start(request.sessionId, profile.name)
      }
      case 'logs.stop':
        return this.journal.stop(request.sessionId)
      case 'logs.chooseFolder': {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        })
        return result.canceled ? undefined : result.filePaths[0]
      }
      case 'logs.export': {
        const result = await dialog.showSaveDialog({
          defaultPath: 'session.txt',
          filters: [{ name: 'Текст UTF-8', extensions: ['txt'] }],
        })
        if (!result.canceled && result.filePath)
          await this.journal.exportTo(request.id, result.filePath)
        return
      }
      case 'monitoring.setVisible':
        this.monitoring.setInterval((await this.settings.get()).monitoringIntervalSeconds)
        return this.monitoring.setVisible(request.sessionId, request.visible)
      case 'monitoring.retry':
        return this.monitoring.retry(request.sessionId)
      case 'files.enqueue': {
        this.requireFileSession(request.sessionId)
        let localRoot = this.localFiles.root
        if (request.direction === 'download') {
          for (const root of this.downloadDirectories) {
            try {
              await ensureLocalPath(root, dirname(request.target))
              localRoot = root
              break
            } catch {
              /* Try the next explicitly granted destination. */
            }
          }
        }
        return this.transfers.enqueue({ ...request, localRoot })
      }
      case 'files.downloadDestination': {
        const settings = await this.settings.get()
        let destination = settings.downloadDirectory || app.getPath('downloads')
        if (request.choose || settings.askDownloadDirectory) {
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: destination,
            title: 'Папка для скачивания',
          })
          if (result.canceled || !result.filePaths[0]) return undefined
          destination = result.filePaths[0]
        }
        destination = await fs.realpath(destination)
        this.downloadDirectories.add(destination)
        return destination
      }
      case 'files.showLocal': {
        const entry = this.transfers.completedDownload(request.path)
        const target = await ensureLocalPath(entry.request.localRoot, request.path)
        shell.showItemInFolder(target)
        return
      }
      case 'files.transfers':
        return this.transfers.list()
      case 'files.clearCompleted':
        return this.transfers.clearCompleted(request.sessionId)
      case 'files.openLocal': {
        const entry = this.transfers.completedDownload(request.path)
        return this.localFiles.openCompleted(
          entry.request.target,
          entry.request.localRoot,
          (path) => shell.openPath(path),
        )
      }
      case 'files.openBrowserLocal': {
        const original = await fs.lstat(request.path)
        if (!original.isFile() || original.isSymbolicLink())
          throw new AppError('regular-file-only', 'Открывать можно только обычные файлы')
        const path = await ensureLocalPath(this.localFiles.root, request.path)
        const error = await openFile(path, request.mode)
        if (error) throw new AppError('file-open', error)
        return
      }
      case 'files.openRemote': {
        this.fileActivity({
          sessionId: request.sessionId,
          path: request.path,
          kind: 'open',
          state: 'running',
          completed: 0,
        })
        try {
          const profile = this.requireFileSession(request.sessionId)
          if (profile.protocol === 'wsl' || profile.protocol === 'local') {
            const root =
              profile.protocol === 'wsl'
                ? await wslRoot(profile.distribution)
                : this.localFiles.root
            const localPath =
              profile.protocol === 'wsl'
                ? await this.wslFiles.accessiblePath(root, request.path, true)
                : await ensureLocalPath(root, request.path)
            if (!(await fs.lstat(localPath)).isFile())
              throw new AppError('regular-file-only', 'Открывать можно только обычные файлы')
            const error = await openFile(localPath, request.mode)
            if (error) throw new AppError('file-open', error)
            return { localPath }
          }
          const stat = await this.remoteFiles.stat(request.sessionId, request.path)
          if (!stat?.isFile() || stat.isSymbolicLink())
            throw new AppError('regular-file-only', 'Открывать можно только обычные файлы')
          return await this.remoteEdits.open(request.sessionId, request.path, (localPath) =>
            openFile(localPath, request.mode),
          )
        } finally {
          this.fileActivity({
            sessionId: request.sessionId,
            path: request.path,
            kind: 'open',
            state: 'done',
            completed: 0,
          })
        }
      }
      case 'files.enqueueDropped': {
        const profile = this.requireFileSession(request.sessionId),
          remoteDirectory =
            profile.protocol === 'wsl'
              ? request.targetDirectory
              : profile.protocol === 'local'
                ? await ensureLocalPath(this.localFiles.root, request.targetDirectory)
                : await this.remoteFiles.realpath(request.sessionId, request.targetDirectory)
        if (isRemoteFileProtocol(profile.protocol)) {
          const remoteStat = await this.remoteFiles.stat(request.sessionId, remoteDirectory)
          if (!remoteStat?.isDirectory())
            throw new AppError('remote-directory-required', 'Перетащите файлы в удалённую папку')
        } else if (
          !(
            await fs.stat(
              profile.protocol === 'wsl'
                ? await this.wslFiles.accessiblePath(
                    await wslRoot(profile.distribution),
                    remoteDirectory,
                  )
                : remoteDirectory,
            )
          ).isDirectory()
        )
          throw new AppError('remote-directory-required', 'Перетащите файлы в удалённую папку')
        const sources = await Promise.all(
          request.paths.map((path) => this.localFiles.validateExternalDroppedFile(path)),
        )
        const batchId = randomUUID()
        const requests = sources.map(({ source, localRoot }) => ({
          batchId,
          sessionId: request.sessionId,
          direction: 'upload' as const,
          source,
          target:
            profile.protocol === 'wsl' || profile.protocol === 'local'
              ? (process.platform === 'win32' ? win32.join : join)(
                  remoteDirectory,
                  validateFileName(basename(source)),
                )
              : posix.join(remoteDirectory, validateFileName(basename(source))),
          overwrite: false,
          localRoot,
        }))
        return this.transfers.enqueueMany(requests)
      }
      case 'files.stageDrag':
        if (!isRemoteFileProtocol(this.requireFileSession(request.sessionId).protocol))
          throw new AppError('files-unsupported', 'Перетаскивание доступно для SSH-файлов')
        return this.externalDrag.prepare(request.sessionId, request.path)
      case 'files.cancel':
        return this.transfers.cancel(request.id)
      case 'files.retry':
        this.requireFileSession(this.transfers.get(request.id).request.sessionId)
        return this.transfers.retry(request.id, request.overwrite, request.targetVersion)
      case 'files.localRoot':
        return this.localFiles.root
      case 'files.chooseLocal': {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          defaultPath: this.localFiles.root,
        })
        if (!result.canceled && result.filePaths[0]) this.localFiles.root = result.filePaths[0]
        return this.localFiles.root
      }
      case 'files.chooseUpload': {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          defaultPath: this.localFiles.root,
        })
        if (result.canceled || !result.filePaths.length) return []
        const parents = new Set(result.filePaths.map((path) => dirname(path)))
        if (parents.size !== 1)
          throw new AppError('upload-directory', 'Выберите файлы из одной папки')
        this.localFiles.root = [...parents][0]
        return result.filePaths
      }
      case 'files.list': {
        if (request.side === 'local') return this.localFiles.list(request.path)
        if (!request.sessionId)
          throw new AppError(
            'files-session-required',
            'Откройте SSH- или WSL-сеанс для работы с файлами',
          )
        const profile = this.requireFileSession(request.sessionId)
        if (profile.protocol === 'wsl') {
          const root = await wslRoot(profile.distribution)
          const path =
            request.path === '.' ? await wslHomeDirectory(profile.distribution, root) : request.path
          return this.wslFiles.list(root, path)
        }
        if (profile.protocol === 'local') {
          const result = await this.localFiles.list(
            request.path === '.' ? this.localFiles.root : request.path,
          )
          return {
            ...result,
            capabilities: {
              ...result.capabilities,
              upload: true,
              download: true,
              dragOut: process.platform === 'win32' || process.platform === 'linux',
            },
          }
        }
        const listing = await this.remoteFiles.list(request.sessionId, request.path)
        return {
          ...listing,
          capabilities: {
            ...listing.capabilities,
            dragOut:
              (process.platform === 'win32' || !!this.linuxDrag?.available()) &&
              listing.capabilities.dragOut,
          },
        }
      }
      case 'files.move': {
        if (request.side === 'local') return this.localFiles.move(request.path, request.destination)
        if (!request.sessionId) throw new AppError('files-session-required', 'Выберите подключение')
        const profile = this.requireFileSession(request.sessionId)
        if (profile.protocol === 'wsl')
          return this.wslFiles.move(
            await wslRoot(profile.distribution),
            request.path,
            request.destination,
          )
        if (profile.protocol === 'local')
          return this.localFiles.move(request.path, request.destination)
        return this.remoteFiles.move(request.sessionId, request.path, request.destination)
      }
      case 'files.mutate': {
        if (request.operation === 'mkdir' || request.operation === 'rename')
          validateFileName(request.name || '')
        if (request.side === 'local') {
          if (request.operation === 'mkdir')
            return this.localFiles.mkdir(request.path, request.name!)
          if (request.operation === 'rename')
            return this.localFiles.rename(request.path, request.name!)
          if (request.operation === 'chmod')
            throw new AppError('chmod-remote-only', 'Изменение прав доступно для удалённых файлов')
          if (request.operation === 'chown')
            throw new AppError(
              'chown-remote-only',
              'Изменение владельца доступно только для SSH-файлов',
            )
          return this.localFiles.remove(request.path, request.fileType || 'file')
        }
        if (!request.sessionId)
          throw new AppError(
            'files-session-required',
            'Откройте SSH- или WSL-сеанс для работы с файлами',
          )
        const profile = this.requireFileSession(request.sessionId)
        if (profile.protocol === 'wsl')
          return this.wslFiles.mutate(await wslRoot(profile.distribution), request)
        if (profile.protocol === 'local') return this.handle({ ...request, side: 'local' })
        return this.remoteFiles.mutate(request)
      }
      case 'sessions.answer':
        return this.challenges.answer(this.ownerId, request.challengeId, request.answer)
      case 'wsl.list':
        return process.platform === 'win32' ? listWslDistributions() : []
      case 'x11.status':
        return this.x11.status()
      case 'x11.start':
        await this.x11.start((await this.settings.get()).x11Clipboard ?? true)
        return this.x11.status()
      case 'x11.stop':
        await this.x11.stop()
        return this.x11.status()
      case 'wsl.inventory':
        return process.platform === 'win32' ? listWslInventory() : []
      case 'identity.chooseKey': {
        const result = await dialog.showOpenDialog({
          title: 'Выберите приватный SSH-ключ',
          defaultPath: await sshKeyPickerDirectory(),
          properties: ['openFile'],
          filters: [{ name: 'SSH private key', extensions: ['*'] }],
        })
        return result.canceled ? undefined : result.filePaths[0]
      }
      case 'ssh.discoverIdentities':
        return discoverSshIdentities()
      case 'identities.list':
        return this.identities.list()
      case 'identities.save':
        return this.withStorageMutation(async () => {
          let existing = (await this.identities.list()).find(
            (item) => item.id === request.identity.id,
          )
          if (existing && !existing.secretRef && !existing.username) {
            const legacy = (await this.hosts.list()).find(
              (host) => 'identityId' in host && host.identityId === existing!.id && host.secretRef,
            )
            if (legacy && 'secretRef' in legacy)
              existing = { ...existing, secretRef: legacy.secretRef }
          }
          const identity = {
            ...request.identity,
            secretRef:
              existing && existing.method !== request.identity.method
                ? undefined
                : existing?.secretRef || request.identity.secretRef,
          }
          if (request.secret !== undefined) {
            identity.secretRef = existing?.secretRef || identity.id
            if (
              secretReferenceIsShared(
                identity.secretRef,
                { identityId: identity.id },
                await this.hosts.list(),
                await this.identities.list(),
              )
            )
              identity.secretRef = randomUUID()
            await this.vault.set(identity.secretRef, request.secret)
          }
          return this.identities.save(identity)
        })
      case 'identities.remove':
        return this.withStorageMutation(async () => {
          const identities = await this.identities.list(),
            identity = identities.find((item) => item.id === request.id)
          if (!identity) return
          const hosts = await this.hosts.list(),
            updated = removeCredentialLinks(
              hosts,
              identity,
              request,
              identities.find((item) => item.id === request.replacementId),
            )
          if (request.detach && !request.replacementId) {
            for (let index = 0; index < hosts.length; index++) {
              const host = updated[index]
              if (hosts[index] !== host && 'secretRef' in host && host.secretRef) {
                const secret = await this.vault.get(host.secretRef)
                const reference = secretReferenceIsShared(
                  host.id,
                  { hostId: host.id },
                  hosts,
                  identities,
                )
                  ? randomUUID()
                  : host.id
                if (secret !== undefined) await this.vault.set(reference, secret)
                updated[index] = {
                  ...host,
                  secretRef: secret !== undefined ? reference : undefined,
                }
              }
            }
          }
          // Update references first; an interrupted operation never leaves a dangling credential ID.
          for (let index = 0; index < hosts.length; index++)
            if (hosts[index] !== updated[index]) await this.hosts.save(updated[index])
          // Keep vault records: detached hosts and historical references can still use them.
          await this.identities.remove(request.id)
        })
      case 'sessions.open': {
        const profile = (await this.hosts.list()).find((host) => host.id === request.profileId)
        this.ensureActive()
        if (!profile) throw new AppError('invalid-profile', 'Подключение не найдено')
        return this.sessions.open(this.ownerId, profile)
      }
      case 'sessions.openLocal': {
        const profile = {
          protocol: 'local' as const,
          shell: normalizeLocalShell(request.shell, process.platform),
          name: localShellLabels[normalizeLocalShell(request.shell, process.platform)],
        }
        return this.sessions.open(this.ownerId, profile)
      }
      case 'sessions.openTemporary': {
        this.temporarySecrets.set(request.profile.id, request.secret)
        return this.sessions.open(this.ownerId, request.profile)
      }
      case 'sessions.write':
        return this.sessions.write(this.ownerId, request.id, request.data)
      case 'sessions.resize':
        return this.sessions.resize(this.ownerId, request.id, request.cols, request.rows)
      case 'sessions.ack':
        return this.sessions.ack(this.ownerId, request.id, request.sequence)
      case 'sessions.close':
        return this.closer.requestSessionClose(this.ownerId, request.id)
      case 'hosts.list': {
        const hosts = await this.hosts.list()
        if (this.hosts.store.warning) this.notice(this.hosts.store.warning)
        return hosts
      }
      case 'hosts.save': {
        return this.withStorageMutation(async () => {
          const previous = (await this.hosts.list()).find(
            (profile) => profile.id === request.profile.id,
          )
          this.ensureActive()
          const clean = ['ssh', 'sftp', 'ftp'].includes(request.profile.protocol)
            ? {
                ...request.profile,
                secretRef:
                  previous &&
                  !(
                    'identityId' in request.profile &&
                    request.profile.identityId &&
                    (!('identityId' in previous) ||
                      previous.identityId !== request.profile.identityId)
                  ) &&
                  previous.protocol === request.profile.protocol &&
                  'secretRef' in previous &&
                  (!('auth' in previous) ||
                    ('auth' in request.profile && previous.auth === request.profile.auth))
                    ? previous.secretRef
                    : undefined,
              }
            : request.profile
          return this.hosts.save(clean)
        })
      }
      case 'hosts.remove': {
        return this.withStorageMutation(async () => {
          const profile = (await this.hosts.list()).find((host) => host.id === request.id)
          this.ensureActive()
          if (profile && 'secretRef' in profile && profile.secretRef) {
            const sharedByHost = (await this.hosts.list()).some(
              (host) =>
                host.id !== profile.id &&
                'secretRef' in host &&
                host.secretRef === profile.secretRef,
            )
            const sharedByIdentity = (await this.identities.list()).some(
              (identity) => identity.secretRef === profile.secretRef,
            )
            if (!sharedByHost && !sharedByIdentity) await this.vault.remove(profile.secretRef)
          }
          return this.hosts.remove(request.id)
        })
      }
      case 'hosts.setSecret': {
        return this.withStorageMutation(async () => {
          const profile = (await this.hosts.list()).find((host) => host.id === request.id)
          this.ensureActive()
          if (
            !profile ||
            (profile.protocol !== 'ssh' &&
              profile.protocol !== 'sftp' &&
              profile.protocol !== 'ftp')
          )
            throw new AppError('invalid-profile', 'Не найдено SSH-подключение')
          if ('identityId' in profile && profile.identityId)
            throw new AppError('invalid-profile', 'Изменяйте общие учётные данные в настройках')
          let reference = profile.secretRef || profile.id
          if (
            secretReferenceIsShared(
              reference,
              { hostId: profile.id },
              await this.hosts.list(),
              await this.identities.list(),
            )
          )
            reference = randomUUID()
          await this.vault.set(reference, request.value)
          return this.hosts.save({ ...profile, secretRef: reference })
        })
      }
      case 'settings.get': {
        await this.settings.flush()
        const value = await this.settings.get()
        if (this.settings.warning) this.notice(this.settings.warning)
        return value
      }
      case 'settings.update':
        return this.withStorageMutation(async () => {
          const settings = await this.settings.update(request.patch)
          this.monitoring.setInterval(settings.monitoringIntervalSeconds)
          return settings
        })
      case 'data.export': {
        const result = await dialog.showSaveDialog({
          title: 'Экспорт резервной копии',
          defaultPath: join(
            app.getPath('documents'),
            `Terminal-backup-${new Date().toISOString().slice(0, 10)}.ptbackup`,
          ),
          filters: [{ name: 'Резервная копия Terminal', extensions: ['ptbackup'] }],
        })
        if (result.canceled || !result.filePath) return
        await Promise.all([
          this.hosts.store.flush(),
          this.identities.store.flush(),
          this.settings.flush(),
          this.knownHosts.flush(),
          this.vault.flush(),
        ])
        const payload: PortableData = {
          hosts: await this.hosts.list(),
          identities: await this.identities.list(),
          settings: await this.settings.get(),
          knownHosts: await this.knownHosts.entries(),
          secrets: await this.vault.exportPlaintext(),
        }
        const archive = await encodePortableBackup(payload, request.passphrase),
          temp = `${result.filePath}.${randomUUID()}.tmp`
        try {
          await fs.writeFile(temp, archive, { mode: 0o600 })
          const file = await fs.open(temp, 'r+')
          try {
            await file.sync()
          } finally {
            await file.close()
          }
          await fs.rename(temp, result.filePath)
        } finally {
          await fs.rm(temp, { force: true }).catch(() => {})
        }
        return
      }
      case 'data.previewImport': {
        const result = await dialog.showOpenDialog({
          title: 'Импорт резервной копии',
          properties: ['openFile'],
          filters: [{ name: 'Резервная копия Terminal', extensions: ['ptbackup'] }],
        })
        if (result.canceled || !result.filePaths[0]) return
        const file = result.filePaths[0],
          stat = await fs.stat(file)
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
          throw new AppError('backup-size', 'Файл резервной копии повреждён или слишком велик')
        const payload = await decodePortableBackup(await fs.readFile(file), request.passphrase),
          [hosts, identities, knownHosts] = await Promise.all([
            this.hosts.list(),
            this.identities.list(),
            this.knownHosts.entries(),
          ]),
          token = randomUUID()
        this.pendingImports.set(token, payload)
        while (this.pendingImports.size > 8)
          this.pendingImports.delete(this.pendingImports.keys().next().value!)
        return {
          token,
          hosts: payload.hosts.length,
          identities: payload.identities.length,
          conflicts: {
            hosts: payload.hosts.filter((item) => hosts.some((current) => current.id === item.id))
              .length,
            identities: payload.identities.filter((item) =>
              identities.some((current) => current.id === item.id),
            ).length,
            knownHosts: Object.keys(payload.knownHosts).filter((key) => key in knownHosts).length,
          },
        }
      }
      case 'data.commitImport': {
        if (this.sessions.list(this.ownerId).length)
          throw new AppError(
            'import-sessions-active',
            'Закройте активные сеансы перед импортом данных',
          )
        if (this.storageMutations)
          throw new AppError(
            'import-storage-busy',
            'Дождитесь завершения сохранения данных и повторите импорт',
          )
        const payload = this.pendingImports.get(request.token)
        if (!payload)
          throw new AppError(
            'import-expired',
            'Предварительный просмотр истёк. Выберите архив снова.',
          )
        this.pendingImports.delete(request.token)
        this.pendingImports.clear()
        this.dataImportInProgress = true
        try {
          await Promise.all([
            this.hosts.store.flush(),
            this.identities.store.flush(),
            this.settings.flush(),
            this.knownHosts.flush(),
            this.vault.flush(),
          ])
          const [hosts, identities, settings, knownHosts, encryptedSecrets] = await Promise.all([
            this.hosts.list(),
            this.identities.list(),
            this.settings.get(),
            this.knownHosts.entries(),
            this.vault.exportEncrypted(),
          ])
          const mergeById = <T extends { id: string }>(current: T[], incoming: T[]) => {
            const values = new Map(current.map((item) => [item.id, item]))
            incoming.forEach((item) => values.set(item.id, item))
            return [...values.values()]
          }
          const nextHosts =
              request.strategy === 'replace' ? payload.hosts : mergeById(hosts, payload.hosts),
            nextIdentities =
              request.strategy === 'replace'
                ? payload.identities
                : mergeById(identities, payload.identities),
            nextKnownHosts =
              request.strategy === 'replace'
                ? payload.knownHosts
                : { ...knownHosts, ...payload.knownHosts },
            importedSecrets = this.vault.encryptAll(payload.secrets),
            nextSecrets =
              request.strategy === 'replace'
                ? importedSecrets
                : { ...encryptedSecrets, ...importedSecrets },
            nextSettings = request.strategy === 'replace' ? payload.settings : settings
          await new DataImportTransaction(app.getPath('userData')).apply(
            new Map([
              [this.hosts.store.path, this.hosts.store.serialize(nextHosts)],
              [this.identities.store.path, this.identities.store.serialize(nextIdentities)],
              [this.settings.path, this.settings.serialize(nextSettings)],
              [this.knownHosts.path, this.knownHosts.serialize(nextKnownHosts)],
              [this.vault.path, this.vault.serialize(nextSecrets)],
            ]),
          )
          this.monitoring.setInterval(nextSettings.monitoringIntervalSeconds)
          return nextSettings
        } finally {
          this.dataImportInProgress = false
        }
      }
      default:
        throw new AppError('not-connected', 'Нет активного подключения')
    }
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.monitoring.close()
    const ids = new Set([
      ...this.sessions.list(this.ownerId).map((entry) => entry.id),
      ...this.transfers
        .list()
        .filter((entry) => ['running', 'queued'].includes(entry.state))
        .map((entry) => entry.sessionId),
    ])
    this.closePromise = (async () => {
      await Promise.all([
        this.nativeDrag.close(),
        this.linuxDrag?.close(),
        this.externalDrag.close(),
        this.remoteEdits.close(),
      ])
      await Promise.all(
        [...this.dragDirectories].map((path) => fs.rm(path, { recursive: true, force: true })),
      )
      await Promise.all(
        [...ids].map((id) =>
          Promise.all([
            this.transfers.closeSession(id, 'user'),
            this.sftp.close(id),
            this.sessions.close(this.ownerId, id),
          ]),
        ),
      )
      await Promise.all([
        this.hosts.store.flush(),
        this.x11.close(),
        this.journal.close(),
        this.settings.flush(),
        this.vault.flush(),
        this.identities.flush(),
      ])
    })()
    return this.closePromise
  }
}
