import type { Metric, MetricSnapshot, MetricPoint, DiskMetrics } from '../../shared/contracts'
import { commands, sections } from './commands'
import { parseTemperatures } from './temperatures'
import {
  parseCpu,
  cpuUsage,
  parseMemory,
  parseNetwork,
  networkRates,
  parseDisks,
  parseUptime,
  parseWho,
  parseLoginSessions,
  parseProcessSessions,
  parseSystem,
  type ObservedSession,
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
  private usersAt = -Infinity
  private users: NonNullable<MetricSnapshot['users']> = unavailable('Ожидание измерения')
  private disks: Metric<DiskMetrics[]> = unavailable('Ожидание измерения')
  private temperatures: NonNullable<MetricSnapshot['temperatures']> =
    unavailable('Ожидание измерения')
  private temperaturesAt = -Infinity
  private history: MetricPoint[] = []
  private listeners = new Set<(snapshot: MetricSnapshot) => void>()
  private now: () => number
  private intervalMs: number
  private currentUser?: string
  private system: Metric<ReturnType<typeof parseSystem>> = unavailable('�������� ���������')
  private pollStartedAt?: number
  constructor(
    private exec: (command: string, signal: AbortSignal) => Promise<string>,
    options: { now?: () => number; intervalSeconds?: number; currentUser?: string } = {},
  ) {
    this.currentUser = options.currentUser
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
    this.usersAt = -Infinity
    this.temperaturesAt = -Infinity
    this.users = unavailable('Ожидание измерения')
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
      users: unavailable(message),
      temperatures: unavailable(message),
      history: [],
    }
  }
  private async optionalExec(command: string, signal: AbortSignal): Promise<string> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) controller.abort()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.exec(command, controller.signal).then((output) => {
          if (output.length > 1048576) throw new Error('����� ������ ������� �������')
          return output
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('��������� ����� ��������'))
          }, 700)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }
  private async readSessions(signal: AbortSignal): Promise<ObservedSession[]> {
    let observed = false
    for (const [command, parse] of [
      [
        commands.users,
        (output: string) =>
          parseWho(output).sessions.map((session) => ({ ...session, source: 'who' as const })),
      ],
      [commands.loginSessions, parseLoginSessions],
      [commands.processSessions, parseProcessSessions],
    ] as const) {
      if (signal.aborted) throw new Error('����� �������')
      try {
        const sessions = parse(await this.optionalExec(command, signal))
        observed = true
        if (sessions.length) return sessions
      } catch {
        /* A missing source must not stop CPU and memory sampling. */
      }
    }
    if (this.currentUser)
      return [{ user: this.currentUser, terminal: '', source: 'current-connection' }]
    if (!observed) throw new Error('��������� ������� ����������')
    return []
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
      if (at - this.temperaturesAt >= 10000) {
        this.temperaturesAt = at
        try {
          const sensors = parseTemperatures(
            await this.optionalExec(commands.temperatures, controller.signal),
          )
          this.temperatures = sensors
            ? value(sensors)
            : unavailable('Датчики температуры недоступны')
          this.temperatures.sampledAt = Date.now()
        } catch {
          this.temperatures = unavailable('Не удалось прочитать датчики температуры')
        }
      }
      if (generation !== this.generation) return
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
      if (at - this.usersAt >= 30000) {
        this.usersAt = at
        try {
          const sessions = await this.readSessions(controller.signal)
          this.users = value({ sessions })
          this.users.sampledAt = Date.now()
        } catch {
          this.users = unavailable('�� ������� ��������� ������: who, loginctl, ps')
        }
        try {
          const system = parseSystem(await this.optionalExec(commands.system, controller.signal))
          this.system = Object.keys(system).length
            ? value(system)
            : unavailable('�������������� ������� ����������')
        } catch {
          this.system = unavailable('�� ������� ��������� �������������� �������')
        }
      }
      if (generation !== this.generation) return
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
        users: this.users,
        temperatures: this.temperatures,
        system: this.system,
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
