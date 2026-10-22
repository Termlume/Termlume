import type { HostProfile, MetricSnapshot } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { LinuxMonitor } from './LinuxMonitor'
interface Source {
  profile: HostProfile
  exec: (command: string, signal: AbortSignal) => Promise<string>
}
export class MonitoringService {
  private monitors = new Map<string, LinuxMonitor>()
  private activeId?: string
  private windowVisible = true
  private intervalSeconds = 3
  constructor(
    private source: (id: string) => Source,
    private sink: (id: string, snapshot: MetricSnapshot) => void,
  ) {}
  setInterval(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
      throw new RangeError('Invalid monitoring interval')
    this.intervalSeconds = seconds
    this.monitors.forEach((monitor) => monitor.setInterval(seconds))
  }
  setVisible(id: string, visible: boolean): void {
    if (!visible) {
      this.monitors.get(id)?.pause()
      if (this.activeId === id) this.activeId = undefined
      return
    }
    const source = this.source(id)
    if (source.profile.protocol !== 'ssh' && source.profile.protocol !== 'wsl')
      throw new AppError('monitor-disabled', 'Мониторинг Linux доступен в SSH-сеансах и WSL')
    if (this.activeId && this.activeId !== id) this.monitors.get(this.activeId)?.pause()
    this.activeId = id
    let monitor = this.monitors.get(id)
    if (!monitor) {
      monitor = new LinuxMonitor(source.exec, {
        intervalSeconds: this.intervalSeconds,
        currentUser: source.profile.protocol === 'ssh' ? source.profile.username : undefined,
      })
      monitor.subscribe((snapshot) => {
        if (this.activeId === id && this.windowVisible) this.sink(id, snapshot)
      })
      this.monitors.set(id, monitor)
    }
    if (this.windowVisible) monitor.start()
  }
  retry(id: string) {
    if (this.activeId !== id || !this.windowVisible)
      throw new AppError('monitor-hidden', 'Откройте панель мониторинга')
    this.monitors.get(id)?.retry()
  }
  setWindowVisible(visible: boolean) {
    this.windowVisible = visible
    if (!visible) this.monitors.forEach((monitor) => monitor.pause())
    else if (this.activeId) this.monitors.get(this.activeId)?.start()
  }
  closeSession(id: string) {
    this.monitors.get(id)?.close()
    this.monitors.delete(id)
    if (this.activeId === id) this.activeId = undefined
  }
  close() {
    this.monitors.forEach((monitor) => monitor.close())
    this.monitors.clear()
    this.activeId = undefined
  }
}
