import type { Metric, MetricSnapshot, MetricPoint, DiskMetrics } from '../../shared/contracts'
import { commands, sections } from './commands'
import {
  parseCpu,
  cpuUsage,
  parseMemory,
  parseNetwork,
  networkRates,
  parseDisks,
  parseUptime,
  type CpuCounters,
  type NetworkCounters,
} from './linux-parsers'
const unavailable = <T>(message: string): Metric<T> => ({ status: 'unavailable', error: message })
const value = <T>(data: T | undefined, message = 'Первое измерение'): Metric<T> =>
  data === undefined ? { status: 'warming-up', error: message } : { status: 'ok', value: data }
const attempt = <T>(read: () => T): Metric<T> => {
  try {
    const result = read()
    return result === undefined ? unavailable('Метрика отсутствует') : value(result)
  } catch (error) {
    return unavailable((error as Error).message)
  }
}
export class LinuxMonitor {
  private active = false
  private closed = false
  private busy = false
  private generation = 0
  private failures = 0
  private checked = false
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private previous?: { cpu?: CpuCounters; network?: NetworkCounters; at: number }
  private diskAt = -Infinity
  private disks: Metric<DiskMetrics[]> = unavailable('Ожидание измерения')
  private history: MetricPoint[] = []
  private listeners = new Set<(snapshot: MetricSnapshot) => void>()
  private now: () => number
  private intervalMs: number
  private pollStartedAt?: number
  constructor(
    private exec: (command: string, signal: AbortSignal) => Promise<string>,
    options: { now?: () => number; intervalSeconds?: number } = {},
  ) {
    this.now = options.now || (() => performance.now())
    this.intervalMs = (options.intervalSeconds ?? 3) * 1000
  }
  setInterval(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
      throw new RangeError('Invalid monitoring interval')
    this.intervalMs = seconds * 1000
    if (this.active && !this.busy) this.schedule()
  }
  private schedule(immediate = false) {
    if (this.timer) clearTimeout(this.timer)
    const elapsed = this.pollStartedAt === undefined ? 0 : this.now() - this.pollStartedAt
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        void this.poll(this.generation)
      },
      immediate ? 0 : Math.max(0, this.intervalMs - elapsed),
    )
  }
  subscribe(listener: (snapshot: MetricSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  start() {
    if (this.closed || this.active) return
    this.active = true
    this.pollStartedAt = undefined
    this.generation++
    this.previous = undefined
    this.history = []
    this.diskAt = -Infinity
    this.failures = 0
    void this.poll(this.generation)
  }
  pause() {
    this.active = false
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.controller?.abort()
    this.previous = undefined
    this.history = []
  }
  retry() {
    this.pause()
    this.checked = false
    this.start()
  }
  close() {
    this.pause()
    this.closed = true
    this.listeners.clear()
  }
  private emit(snapshot: MetricSnapshot) {
    this.listeners.forEach((listener) => listener(snapshot))
  }
  private failed(message: string, state: MetricSnapshot['state']): MetricSnapshot {
    return {
      sampledAt: Date.now(),
      state,
      error: message,
      cpuPercent: unavailable(message),
      ram: unavailable(message),
      swap: unavailable(message),
      network: unavailable(message),
      uptime: unavailable(message),
      disks: unavailable(message),
      history: [],
    }
  }
  private async poll(generation: number): Promise<void> {
    if (!this.active || this.busy || this.closed) return
    this.busy = true
    this.pollStartedAt = this.now()
    const controller = new AbortController()
    this.controller = controller
    try {
      if (!this.checked) {
        const os = await this.exec(commands.os, controller.signal)
        if (generation !== this.generation) return
        if (os.trim() !== 'Linux') {
          this.active = false
          this.emit(
            this.failed(
              'Мониторинг поддерживает Linux. Терминал остаётся доступен.',
              'unsupported',
            ),
          )
          return
        }
        this.checked = true
      }
      const raw = sections(await this.exec(commands.fast, controller.signal))
      if (generation !== this.generation) return
      const at = this.now(),
        cpu = attempt(() => parseCpu(raw.CPU || '')),
        network = attempt(() => parseNetwork(raw.NET || '')),
        memory = parseMemory(raw.MEM || '')
      const cpuMetric =
        cpu.status === 'ok'
          ? value(cpuUsage(cpu.value!, this.previous?.cpu))
          : unavailable<number>(cpu.error!)
      const netMetric =
        network.status === 'ok'
          ? value(
              networkRates(
                network.value!,
                this.previous?.network,
                this.previous ? (at - this.previous.at) / 1000 : 0,
              ),
            )
          : unavailable<NonNullable<MetricSnapshot['network']['value']>>(network.error!)
      const ram = memory.ram
        ? value(memory.ram)
        : unavailable<NonNullable<MetricSnapshot['ram']['value']>>('MemAvailable недоступен')
      const swap = memory.swap
        ? value(memory.swap)
        : unavailable<NonNullable<MetricSnapshot['swap']['value']>>('Swap недоступен')
      const uptime = attempt(() => parseUptime(raw.UPTIME || ''))
      if ([cpuMetric, netMetric, ram, uptime].every((metric) => metric.status === 'unavailable'))
        throw new Error('Метрики Linux недоступны')
      if (at - this.diskAt >= 30000) {
        this.diskAt = at
        try {
          this.disks = value(parseDisks(await this.exec(commands.disks, controller.signal)))
          this.disks.sampledAt = Date.now()
        } catch {
          this.disks = unavailable('Не удалось прочитать диски')
        }
      }
      if (generation !== this.generation) return
      this.previous = { cpu: cpu.value, network: network.value, at }
      this.failures = 0
      const sampledAt = Date.now()
      this.history.push({
        sampledAt,
        cpuPercent: cpuMetric.value,
        ramPercent:
          ram.value && ram.value.total ? (ram.value.used / ram.value.total) * 100 : undefined,
        rx: netMetric.value?.rx,
        tx: netMetric.value?.tx,
      })
      this.history = this.history
        .filter((point) => point.sampledAt >= sampledAt - 300000)
        .slice(-301)
      this.emit({
        sampledAt,
        state: 'sampling',
        cpuPercent: cpuMetric,
        ram,
        swap,
        network: netMetric,
        uptime,
        disks: this.disks,
        history: [...this.history],
      })
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      this.failures++
      if (this.failures >= 3) this.active = false
      this.emit(this.failed((error as Error).message, this.failures >= 3 ? 'paused' : 'error'))
    } finally {
      this.busy = false
      if (this.active && !this.closed) this.schedule(generation !== this.generation)
    }
  }
}
