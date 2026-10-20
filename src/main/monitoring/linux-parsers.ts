import type { MemoryUsage, DiskMetrics, NetworkRates } from '../../shared/contracts'
export interface CpuCounters {
  total: number
  idle: number
}
export type NetworkCounters = Record<string, { rx: number; tx: number }>
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
    ram: usage(fields.MemTotal, fields.MemAvailable),
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
