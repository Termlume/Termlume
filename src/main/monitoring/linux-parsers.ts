import { sections } from './commands'
import type { MemoryUsage, DiskMetrics, NetworkRates } from '../../shared/contracts'
export interface CpuCounters {
  total: number
  idle: number
}
export type NetworkCounters = Record<string, { rx: number; tx: number }>
export function parseWho(text: string) {
  const sessions: { user: string; terminal: string; loginText?: string; from?: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match =
      /^(\S+)\s+(\S+)\s+((?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2}\s+\d{1,2})\s+\d{2}:\d{2}(?::\d{2})?)(?:\s+\(([^\r\n]*)\))?\s*$/.exec(
        line,
      )
    if (!match) throw new Error('Некорректный ответ who')
    sessions.push({
      user: match[1],
      terminal: match[2],
      loginText: match[3],
      ...(match[4] === undefined ? {} : { from: match[4] }),
    })
  }
  return { sessions }
}
export function parseCpu(text: string): CpuCounters {
  const line = text.split('\n').find((line) => /^cpu\s/.test(line))
  if (!line) throw new Error('Нет /proc/stat')
  const values = line.trim().split(/\s+/).slice(1, 9).map(Number)
  if (values.length < 4 || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Некорректные CPU-счётчики')
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    idle: values[3] + (values[4] || 0),
  }
}
export function cpuUsage(current: CpuCounters, previous?: CpuCounters): number | undefined {
  if (!previous) return undefined
  const total = current.total - previous.total,
    idle = current.idle - previous.idle
  if (total <= 0 || idle < 0 || idle > total) return undefined
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100))
}
export function parseMemory(text: string): { ram?: MemoryUsage; swap?: MemoryUsage } {
  const fields: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s*(\d+)\s+kB\s*$/.exec(line)
    if (match) fields[match[1]] = Number(match[2]) * 1024
  }
  const usage = (total: number | undefined, available: number | undefined) =>
    total !== undefined && available !== undefined && available <= total
      ? { total, available, used: total - available }
      : undefined
  return {
    ram: (() => {
      const ram = usage(fields.MemTotal, fields.MemAvailable)
      return ram ? { ...ram, cached: fields.Cached, buffers: fields.Buffers } : undefined
    })(),
    swap: usage(fields.SwapTotal, fields.SwapFree),
  }
}
export function parseNetwork(text: string): NetworkCounters {
  const result: NetworkCounters = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const fields = match[2].trim().split(/\s+/).map(Number)
    if (fields.length >= 16 && fields.every((value) => Number.isFinite(value) && value >= 0))
      result[match[1].trim()] = { rx: fields[0], tx: fields[8] }
  }
  if (!Object.keys(result).length) throw new Error('Нет /proc/net/dev')
  return result
}
export function networkRates(
  current: NetworkCounters,
  previous: NetworkCounters | undefined,
  seconds: number,
): NetworkRates | undefined {
  if (!previous || seconds <= 0) return undefined
  const interfaces: NetworkRates['interfaces'] = []
  let rx = 0,
    tx = 0
  for (const [name, value] of Object.entries(current)) {
    const before = previous[name]
    if (name === 'lo' || !before || value.rx < before.rx || value.tx < before.tx) continue
    const speed = {
      name,
      rx: (value.rx - before.rx) / seconds,
      tx: (value.tx - before.tx) / seconds,
    }
    interfaces.push(speed)
    rx += speed.rx
    tx += speed.tx
  }
  return interfaces.length ? { rx, tx, interfaces } : undefined
}
export function parseDisks(text: string): DiskMetrics[] {
  const result: DiskMetrics[] = []
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue
    const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line)
    if (!match) continue
    result.push({
      device: match[1],
      total: Number(match[2]) * 1024,
      used: Number(match[3]) * 1024,
      available: Number(match[4]) * 1024,
      percent: Number(match[5]),
      mount: match[6],
    })
  }
  if (!result.length) throw new Error('Не удалось прочитать df -Pk')
  return result
}
export function parseUptime(text: string): number {
  if (!text.trim()) throw new Error('Нет /proc/uptime')
  const value = Number(text.trim().split(/\s+/)[0])
  if (!Number.isFinite(value) || value < 0) throw new Error('Нет /proc/uptime')
  return value
}

export type SessionSource = 'who' | 'loginctl' | 'process' | 'current-connection'
export interface ObservedSession {
  user: string
  terminal: string
  loginText?: string
  from?: string
  source?: SessionSource
}
export function parseLoginSessions(text: string): ObservedSession[] {
  const result: ObservedSession[] = []
  for (const block of text.split('__SESSION_END__')) {
    const fields = Object.fromEntries(
      block
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const i = line.indexOf('=')
          return [line.slice(0, i), line.slice(i + 1)]
        }),
    )
    if (
      !fields.Name ||
      !fields.TTY ||
      fields.State === 'closing' ||
      (fields.Class && !['user', 'user-early'].includes(fields.Class))
    )
      continue
    result.push({
      user: fields.Name,
      terminal: fields.TTY,
      ...(fields.RemoteHost ? { from: fields.RemoteHost } : {}),
      source: 'loginctl',
    })
  }
  return result
}
export function parseProcessSessions(text: string): ObservedSession[] {
  const result = new Map<string, ObservedSession>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\S+)\s+(\S+)\s+(.+)$/.exec(line)
    if (!match || !/^(?:pts\/\d+|tty\d+)$/.test(match[2])) continue
    if (
      !/^(?:sshd(?:-session)?:|(?:-)?(?:\/\S*\/)?(?:bash|zsh|sh|fish|dash|ksh)(?:\s|$))/.test(
        match[3],
      )
    )
      continue
    result.set(`${match[1]}:${match[2]}`, { user: match[1], terminal: match[2], source: 'process' })
  }
  return [...result.values()]
}
export function parseSystem(text: string) {
  const raw = sections(text)
  const result: {
    hostname?: string
    loadAverage?: number[]
    processes?: { running: number; total: number }
    fileDescriptors?: { allocated: number; maximum: number }
    connections?: {
      total: number
      ports: { port: number; count: number }[]
      details?: string
      source?: 'ss' | 'netstat'
      truncated?: boolean
    }
    nfsMounts?: { source: string; mount: string; type: string }[]
  } = {}
  const load = /^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\/(\d+)/.exec((raw.LOAD || '').trim())
  if (load) {
    result.loadAverage = load.slice(1, 4).map(Number)
  }
  if (raw.PROCESSES?.includes('__PS_OK__')) {
    const states = raw.PROCESSES.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[RSDTtXZIKWP][a-zA-Z<NLsl+]*$/.test(line))
    result.processes = {
      running: states.filter((state) => state.startsWith('R')).length,
      total: states.length,
    }
  }
  const files = /^(\d+)\s+(\d+)\s+(\d+)/.exec((raw.FILES || '').trim())
  if (files)
    result.fileDescriptors = {
      allocated: Math.max(0, Number(files[1]) - Number(files[2])),
      maximum: Number(files[3]),
    }
  if (raw.HOST?.trim()) result.hostname = raw.HOST.trim()
  if (raw.MOUNTS?.includes('__MOUNTS_OK__'))
    result.nfsMounts = raw.MOUNTS.trim()
      .split(/\r?\n/)
      .flatMap((line) => {
        const f = line.split(/\s+/)
        const decode = (v: string) =>
          v.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
        return ['nfs', 'nfs4'].includes(f[2])
          ? [{ source: decode(f[0]), mount: decode(f[1]), type: f[2] }]
          : []
      })
  if (raw.CONNECTIONS?.includes('__SS_OK__') || raw.CONNECTIONS?.includes('__NETSTAT_OK__')) {
    const source = raw.CONNECTIONS.includes('__SS_OK__') ? ('ss' as const) : ('netstat' as const)
    const output = raw.CONNECTIONS.replace(/__(?:SS|NETSTAT)_OK__/g, '').trim()
    const ports = new Map<number, number>()
    let total = 0
    for (const line of output.split(/\r?\n/)) {
      const f = line.trim().split(/\s+/)
      let endpoint: string | undefined
      if (source === 'netstat') {
        if (!/^tcp6?$/.test(f[0]) || f[5] !== 'ESTABLISHED') continue
        endpoint = f[3]
      } else {
        if (f[0] === 'ESTAB') endpoint = f[3]
        else if (/^\d+$/.test(f[0]) && /^\d+$/.test(f[1])) endpoint = f[2]
        else continue
      }
      const match = endpoint && /:(\d+)$/.exec(endpoint)
      if (!match) continue
      const port = Number(match[1])
      total++
      ports.set(port, (ports.get(port) || 0) + 1)
    }
    result.connections = {
      total,
      ports: [...ports].map(([port, count]) => ({ port, count })).sort((a, b) => a.port - b.port),
      source,
      details: output.slice(0, 65536),
      truncated: output.length > 65536,
    }
  }
  return result
}
