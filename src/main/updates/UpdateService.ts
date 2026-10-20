import type { AppUpdater } from 'electron-updater'
import type { UpdateInfo } from 'builder-util-runtime'
import type { Settings, UpdateChannel, UpdateStatus } from '../../shared/contracts'
import { AppError } from '../../shared/errors'

type Driver = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'setFeedURL'
  | 'on'
  | 'removeListener'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
>
const prerelease = (version: string) => version.split('+')[0].includes('-')
export class UpdateService {
  private value: UpdateStatus
  private active?: 'checking' | 'downloading' | 'installing' | 'channel'
  private disposed = false
  private startup?: ReturnType<typeof setTimeout>
  private periodic?: ReturnType<typeof setInterval>
  constructor(
    private driver: Driver,
    options: { currentVersion: string; channel: UpdateChannel; enabled: boolean },
    private emit: (status: UpdateStatus) => void,
    private prepareInstall: () => Promise<boolean>,
  ) {
    this.value = {
      state: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      channel: options.channel,
      ...(!options.enabled
        ? {
            message:
              'Автообновление доступно в установленной версии Windows. Установите Termlume через установщик.',
          }
        : {}),
    }
    this.configure(options.channel)
    driver.on('update-available', this.available)
    driver.on('update-not-available', this.unavailable)
    driver.on('download-progress', this.progress)
    driver.on('update-downloaded', this.downloaded)
    driver.on('error', this.failed)
  }
  private configure(channel: UpdateChannel) {
    this.driver.autoDownload = false
    this.driver.autoInstallOnAppQuit = false
    // Do not set updater.channel: its setter implicitly enables downgrades.
    // GitHub selects releases via allowPrerelease and reads matching tag metadata.
    this.driver.setFeedURL({
      provider: 'github',
      owner: 'Termlume',
      repo: 'Termlume',
      channel: channel === 'stable' ? 'latest' : 'beta',
    })
    this.driver.allowPrerelease = channel === 'prerelease'
    this.driver.allowDowngrade = false
  }
  status(): UpdateStatus {
    return { ...this.value }
  }
  private set(patch: Partial<UpdateStatus>) {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }
    this.emit(this.status())
  }
  private details(info: UpdateInfo): Partial<UpdateStatus> {
    return {
      version: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : info.releaseNotes?.map((note) => `${note.version}\n${note.note ?? ''}`).join('\n\n'),
    }
  }
  private available = (info: UpdateInfo) => {
    if (this.active !== 'checking') return
    if (this.value.channel === 'stable' && prerelease(info.version)) {
      this.set({
        state: 'not-available',
        version: undefined,
        message: 'Новых стабильных версий нет',
      })
      return
    }
    this.set({ state: 'available', ...this.details(info), message: undefined })
  }
  private unavailable = (_info: UpdateInfo) => {
    if (this.active === 'checking') this.set({ state: 'not-available', version: undefined })
  }
  private progress = (info: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }) => {
    if (this.active === 'downloading')
      this.set({
        state: 'downloading',
        percent: Math.max(0, Math.min(100, info.percent)),
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond,
      })
  }
  private downloaded = (info: UpdateInfo) => {
    if (this.active === 'downloading')
      this.set({ state: 'downloaded', ...this.details(info), percent: 100 })
  }
  private failed = (error: Error) => {
    const failure = error as Error & {
      code?: string
      statusCode?: number
      cause?: { statusCode?: number }
    }
    // GitHub wraps authentication/network failures in LATEST_VERSION_NOT_FOUND too.
    // Only a 404 from /latest means that a first stable release is still absent.
    const noStableRelease =
      failure.code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' ||
      (failure.code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' &&
        (failure.statusCode === 404 ||
          failure.cause?.statusCode === 404 ||
          /(?:HttpError:\s*404\b|\b404\s+(?:Not Found|\"method:))/i.test(failure.message)))
    if (this.active === 'checking' && this.value.channel === 'stable' && noStableRelease) {
      this.set({
        state: 'not-available',
        message: 'Стабильных выпусков пока нет',
        error: undefined,
        version: undefined,
      })
      return
    }
    if (this.active && this.active !== 'channel')
      this.set({ state: 'error', error: error.message.slice(0, 600) })
  }
  private requireIdle() {
    if (this.active) throw new AppError('update-busy', 'Дождитесь завершения операции обновления')
    if (this.disposed) throw new AppError('closing', 'Приложение завершает работу')
  }
  async changeChannel(
    channel: UpdateChannel | undefined,
    persist: () => Promise<Settings>,
  ): Promise<Settings> {
    if (channel === this.value.channel) return persist()
    this.requireIdle()
    this.active = 'channel'
    try {
      const settings = await persist()
      const next = settings.updateChannel ?? 'stable'
      if (next !== this.value.channel) {
        this.configure(next)
        const disabled = this.value.state === 'disabled'
        this.value = {
          currentVersion: this.value.currentVersion,
          channel: next,
          state: disabled ? 'disabled' : 'idle',
          ...(disabled ? { message: this.value.message } : {}),
        }
        this.emit(this.status())
      }
      return settings
    } finally {
      this.active = undefined
    }
  }
  async check(): Promise<UpdateStatus> {
    if (['disabled', 'downloaded', 'installing'].includes(this.value.state)) return this.status()
    if (this.active) return this.status()
    this.requireIdle()
    this.active = 'checking'
    this.set({
      state: 'checking',
      error: undefined,
      message: undefined,
      version: undefined,
      releaseNotes: undefined,
      releaseName: undefined,
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
    })
    try {
      await this.driver.checkForUpdates()
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.active = undefined
    }
    return this.status()
  }
  async download(): Promise<void> {
    this.requireIdle()
    if (this.value.state !== 'available')
      throw new AppError('update-unavailable', 'Сначала найдите доступное обновление')
    this.active = 'downloading'
    this.set({ state: 'downloading', percent: 0, error: undefined })
    try {
      await this.driver.downloadUpdate()
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.active = undefined
    }
  }
  async install(): Promise<void> {
    this.requireIdle()
    if (this.value.state !== 'downloaded')
      throw new AppError('update-not-downloaded', 'Сначала скачайте обновление')
    this.active = 'installing'
    this.set({ state: 'installing', error: undefined })
    try {
      if (!(await this.prepareInstall())) {
        this.set({ state: 'downloaded', message: 'Установка отменена' })
        return
      }
      this.driver.quitAndInstall(false, true)
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.active = undefined
    }
  }
  scheduleChecks() {
    if (this.value.state === 'disabled' || this.startup || this.periodic) return
    this.startup = setTimeout(() => {
      this.startup = undefined
      void this.check()
    }, 10000)
    this.periodic = setInterval(
      () => {
        if (!['downloaded', 'installing'].includes(this.value.state)) void this.check()
      },
      6 * 60 * 60 * 1000,
    )
    this.startup.unref?.()
    this.periodic.unref?.()
  }
  dispose() {
    this.disposed = true
    if (this.startup) clearTimeout(this.startup)
    if (this.periodic) clearInterval(this.periodic)
    this.driver.removeListener('update-available', this.available)
    this.driver.removeListener('update-not-available', this.unavailable)
    this.driver.removeListener('download-progress', this.progress)
    this.driver.removeListener('update-downloaded', this.downloaded)
    // Retain an inert error listener for a network operation ending during shutdown.
    // EventEmitter otherwise treats a late updater error as an uncaught exception.
  }
}
