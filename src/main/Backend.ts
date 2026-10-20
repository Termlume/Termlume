import { basename, dirname, join, posix, win32 } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { LocalFilesService } from './sftp/LocalFilesService'
import { SftpService } from './sftp/SftpService'
import { ScpService } from './sftp/ScpService'
import { RemoteFileAccess } from './sftp/RemoteFileAccess'
import { ExternalDragService } from './sftp/ExternalDragService'
import { WindowsDropTransfer } from './sftp/WindowsDropTransfer'
import { RemoteEditService } from './sftp/RemoteEditService'
import { openFile } from './sftp/FileOpener'
import { ensureLocalPath, validateFileName } from './sftp/local-paths'
import { TransferQueue } from './sftp/TransferQueue'
import { MonitoringService } from './monitoring/MonitoringService'
import { execText } from './monitoring/exec-text'
import { CloseCoordinator, type CloseSummary } from './lifecycle/close-coordinator'
import { HostRepository } from './storage/HostRepository'
import { SettingsRepository } from './storage/SettingsRepository'
import { KnownHostsRepository } from './storage/KnownHostsRepository'
import { IdentityRepository } from './storage/IdentityRepository'
import { SecretVault } from './storage/SecretVault'
import { DataImportTransaction } from './storage/DataImportTransaction'
import {
  decodePortableBackup,
  encodePortableBackup,
  type PortableData,
} from './storage/portable-backup'
import { windowsSecrets } from './platform/windows-secrets'
import type { Request } from '../shared/schemas'
import { AppError } from '../shared/errors'
import { SessionManager } from './sessions/SessionManager'
import { WslAdapter } from './sessions/WslAdapter'
import { SshAdapter } from './sessions/SshAdapter'
import { SshChallenges } from './sessions/SshChallenges'
import { TelnetAdapter } from './sessions/TelnetAdapter'
import { LocalShellAdapter } from './sessions/LocalShellAdapter'
import { discoverSshIdentities } from './ssh/discover-identities'
import { listWslDistributions, wslRoot } from './platform/wsl'
import { WslFileAccess } from './sftp/WslFileAccess'
import type {
  SessionEvent,
  TransferSnapshot,
  MetricSnapshot,
  FileDragRequest,
  FileActivity,
} from '../shared/contracts'
export class Backend {
  readonly hosts: HostRepository
  readonly settings: SettingsRepository
  readonly knownHosts: KnownHostsRepository
  readonly identities: IdentityRepository
  readonly vault: SecretVault
  readonly sessions: SessionManager
  readonly temporarySecrets = new Map<string, string | undefined>()
  readonly challenges = new SshChallenges()
  readonly sftp: SftpService
  readonly remoteFiles: RemoteFileAccess
  readonly externalDrag: ExternalDragService
  private readonly nativeDrag = new WindowsDropTransfer(
    app.isPackaged
      ? join(process.resourcesPath, 'native', 'Termlume.FileDrag.exe')
      : join(app.getAppPath(), 'native', 'windows-drag', 'bin', 'Termlume.FileDrag.exe'),
  )
  private readonly dragDirectories = new Set<string>()
  readonly remoteEdits: RemoteEditService
  readonly transfers: TransferQueue
  readonly monitoring: MonitoringService
  readonly localFiles = new LocalFilesService(app.getPath('home'))
  readonly wslFiles = new WslFileAccess()
  readonly closer: CloseCoordinator
  private closing = false
  private closePromise?: Promise<void>
  private storageMutations = 0
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
    void this.nativeDrag.ready().catch(() => {})
    this.hosts = new HostRepository(join(root, 'hosts.json'))
    this.settings = new SettingsRepository(join(root, 'settings.json'))
    this.knownHosts = new KnownHostsRepository(join(root, 'known-hosts.json'))
    this.identities = new IdentityRepository(join(root, 'identities.json'))
    this.vault = new SecretVault(join(root, 'secrets.json'), windowsSecrets)
    this.sessions = new SessionManager(
      async (profile, id) => {
        if (profile.protocol === 'local') return new LocalShellAdapter(profile.shell)
        const temporary = this.temporarySecrets.has(profile.id),
          initialSecret = this.temporarySecrets.get(profile.id)
        this.temporarySecrets.delete(profile.id)
        if (profile.protocol === 'wsl') return new WslAdapter(profile)
        if (profile.protocol === 'telnet') return new TelnetAdapter(profile)
        if (profile.protocol === 'ssh') {
          const identity =
            !temporary && profile.identityId
              ? (await this.identities.list()).find((value) => value.id === profile.identityId)
              : undefined
          const reference = identity?.secretRef || profile.secretRef || identity?.id || profile.id
          const remember = temporary
            ? undefined
            : async (value: string) => {
                try {
                  await this.vault.set(reference, value)
                  if (identity) await this.identities.save({ ...identity, secretRef: reference })
                  else {
                    const current = (await this.hosts.list()).find((host) => host.id === profile.id)
                    if (current?.protocol === 'ssh')
                      await this.hosts.save({ ...current, secretRef: reference })
                  }
                } catch {
                  this.notice(
                    'Не удалось сохранить секрет с защитой Windows. Введите его снова при следующем подключении.',
                  )
                }
              }
          const clearStoredSecret = async () => {
            await this.vault.remove(reference)
            if (identity) {
              const { secretRef: _secretRef, ...metadata } = identity
              await this.identities.save(metadata)
            } else {
              const current = (await this.hosts.list()).find((host) => host.id === profile.id)
              if (current?.protocol === 'ssh') {
                const { secretRef: _secretRef, ...metadata } = current
                await this.hosts.save(metadata)
              }
            }
          }
          return new SshAdapter(profile, {
            knownHosts: this.knownHosts,
            vault: this.vault,
            challenges: this.challenges,
            ownerId: this.ownerId,
            sessionId: id,
            identity,
            initialSecret,
            remember,
            clearStoredSecret,
          })
        }
        throw new AppError('protocol-unavailable', 'Протокол недоступен')
      },
      (_owner, event) => {
        if (
          event.type === 'closed' ||
          (event.type === 'state' && ['error', 'disconnected'].includes(event.state))
        ) {
          this.monitoring?.closeSession(event.sessionId)
          void this.transfers?.closeSession(event.sessionId)
          void this.sftp?.close(event.sessionId)
          this.remoteFiles?.close(event.sessionId)
        }
        emit(event)
      },
    )
    this.sftp = new SftpService((id) => this.ssh(id).getClient())
    this.remoteFiles = new RemoteFileAccess(
      this.sftp,
      new ScpService((id) => this.ssh(id).getClient()),
    )
    this.transfers = new TransferQueue(async (request, signal, progress) => {
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
      if (profile.protocol !== 'ssh')
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
        exec: (command, signal) => execText(this.ssh(id).getClient(), command, signal),
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
    if (profile.protocol === 'ssh') this.ssh(id).getClient()
    else if (profile.protocol !== 'wsl' && profile.protocol !== 'local')
      throw new AppError(
        'files-unsupported',
        'Telnet не поддерживает передачу файлов: у него нет файлового канала.',
      )
    return profile
  }
  async beginExternalDrag(request: FileDragRequest, sender: Electron.WebContents) {
    this.ensureActive()
    const profile = this.requireFileSession(request.sessionId)
    const name = validateFileName(
      profile.protocol === 'ssh' ? posix.basename(request.path) : win32.basename(request.path),
    )
    if (profile.protocol === 'ssh') {
      const stat = await this.remoteFiles.lstat(request.sessionId, request.path)
      if (!stat?.isFile() || stat.isSymbolicLink())
        throw new AppError('regular-file-only', 'Переносить можно только обычные файлы')
    } else {
      const root =
        profile.protocol === 'wsl' ? await wslRoot(profile.distribution) : this.localFiles.root
      const source = await ensureLocalPath(root, request.path)
      if (!(await fs.lstat(source)).isFile())
        throw new AppError('regular-file-only', 'Переносить можно только обычные файлы')
    }
    const handle = BrowserWindow.fromWebContents(sender)?.getNativeWindowHandle()
    const sourceWindow =
      handle?.length === 8
        ? handle.readBigUInt64LE().toString(16)
        : handle?.readUInt32LE().toString(16)
    let directory: string | undefined
    try {
      return await this.nativeDrag.drag({ name, sourceWindow }, async (signal) => {
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
      })
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
      case 'monitoring.setVisible':
        this.monitoring.setInterval((await this.settings.get()).monitoringIntervalSeconds)
        return this.monitoring.setVisible(request.sessionId, request.visible)
      case 'monitoring.retry':
        return this.monitoring.retry(request.sessionId)
      case 'files.enqueue':
        this.requireFileSession(request.sessionId)
        return this.transfers.enqueue({ ...request, localRoot: this.localFiles.root })
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
          if (profile.protocol !== 'ssh') {
            const root =
              profile.protocol === 'wsl'
                ? await wslRoot(profile.distribution)
                : this.localFiles.root
            const localPath = await ensureLocalPath(root, request.path)
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
            profile.protocol !== 'ssh'
              ? await ensureLocalPath(
                  profile.protocol === 'wsl'
                    ? await wslRoot(profile.distribution)
                    : this.localFiles.root,
                  request.targetDirectory,
                )
              : await this.remoteFiles.realpath(request.sessionId, request.targetDirectory)
        if (profile.protocol === 'ssh') {
          const remoteStat = await this.remoteFiles.stat(request.sessionId, remoteDirectory)
          if (!remoteStat?.isDirectory())
            throw new AppError('remote-directory-required', 'Перетащите файлы в удалённую папку')
        } else if (!(await fs.stat(remoteDirectory)).isDirectory())
          throw new AppError('remote-directory-required', 'Перетащите файлы в удалённую папку')
        const sources = await Promise.all(
          request.paths.map((path) => this.localFiles.validateExternalDroppedFile(path)),
        )
        const requests = sources.map(({ source, localRoot }) => ({
          sessionId: request.sessionId,
          direction: 'upload' as const,
          source,
          target:
            profile.protocol !== 'ssh'
              ? win32.join(remoteDirectory, validateFileName(basename(source)))
              : posix.join(remoteDirectory, validateFileName(basename(source))),
          overwrite: false,
          localRoot,
        }))
        return this.transfers.enqueueMany(requests)
      }
      case 'files.stageDrag':
        if (this.requireFileSession(request.sessionId).protocol !== 'ssh')
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
        if (profile.protocol === 'wsl')
          return this.wslFiles.list(await wslRoot(profile.distribution), request.path)
        if (profile.protocol === 'local') {
          const result = await this.localFiles.list(
            request.path === '.' ? this.localFiles.root : request.path,
          )
          return {
            ...result,
            capabilities: { ...result.capabilities, upload: true, download: true, dragOut: true },
          }
        }
        return this.remoteFiles.list(request.sessionId, request.path)
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
        return listWslDistributions()
      case 'identity.chooseKey': {
        const result = await dialog.showOpenDialog({
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
        return this.withStorageMutation(() => this.identities.save(request.identity))
      case 'identities.remove':
        return this.withStorageMutation(() => this.identities.remove(request.id))
      case 'sessions.open': {
        const profile = (await this.hosts.list()).find((host) => host.id === request.profileId)
        this.ensureActive()
        if (!profile) throw new AppError('invalid-profile', 'Подключение не найдено')
        return this.sessions.open(this.ownerId, profile)
      }
      case 'sessions.openLocal': {
        const profile = {
          protocol: 'local' as const,
          shell: request.shell,
          name: request.shell === 'powershell' ? 'PowerShell' : 'Command Prompt',
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
          const clean =
            request.profile.protocol === 'ssh'
              ? {
                  ...request.profile,
                  secretRef:
                    previous?.protocol === 'ssh' && previous.auth === request.profile.auth
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
          if (profile?.protocol === 'ssh' && profile.secretRef)
            await this.vault.remove(profile.secretRef)
          return this.hosts.remove(request.id)
        })
      }
      case 'hosts.setSecret': {
        return this.withStorageMutation(async () => {
          const profile = (await this.hosts.list()).find((host) => host.id === request.id)
          this.ensureActive()
          if (!profile || profile.protocol !== 'ssh')
            throw new AppError('invalid-profile', 'Не найдено SSH-подключение')
          await this.vault.set(profile.id, request.value)
          return this.hosts.save({ ...profile, secretRef: profile.id })
        })
      }
      case 'settings.get': {
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
        this.settings.flush(),
        this.vault.flush(),
        this.identities.flush(),
      ])
    })()
    return this.closePromise
  }
}
