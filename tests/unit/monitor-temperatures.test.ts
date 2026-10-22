import { afterEach, expect, it, vi } from 'vitest'
import { parseTemperatures } from '../../src/main/monitoring/temperatures'
import { LinuxMonitor } from '../../src/main/monitoring/LinuxMonitor'
import { commands } from '../../src/main/monitoring/commands'
import type { MetricSnapshot } from '../../src/shared/contracts'

afterEach(() => vi.useRealTimers())
it('reads labeled hwmon and thermal millidegrees, preserving a real zero', () => {
  expect(
    parseTemperatures(
      '/sys/class/hwmon/hwmon0/temp1_input\tcoretemp Package id 0\t42500\n/sys/class/thermal/thermal_zone0/temp\tx86_pkg_temp\t0',
    ),
  ).toEqual([
    { id: '/sys/class/hwmon/hwmon0/temp1_input', label: 'coretemp Package id 0', celsius: 42.5 },
    { id: '/sys/class/thermal/thermal_zone0/temp', label: 'x86_pkg_temp', celsius: 0 },
  ])
})
it('bounds sensor output and rejects absent, malformed and unreasonable data', () => {
  for (const output of [
    '',
    '/sys/class/hwmon/hwmon0/temp1_input\tCPU\t',
    '/sys/class/thermal/thermal_zone0/temp\tCPU\t999999',
    '/etc/passwd\tCPU\t45000',
  ])
    expect(parseTemperatures(output)).toBeUndefined()
  const row = '/sys/class/hwmon/hwmon0/temp1_input\tCPU\t45000'
  expect(parseTemperatures(`${row}\n${row}`)).toHaveLength(1)
  expect(
    parseTemperatures(
      Array.from(
        { length: 100 },
        (_, n) => `/sys/class/hwmon/hwmon0/temp${n}_input\tCPU\t45000`,
      ).join('\n'),
    ),
  ).toHaveLength(64)
})
it('temperature timeout stays unavailable while CPU/RAM and user fallback continue sampling', async () => {
  vi.useFakeTimers()
  const snapshots: MetricSnapshot[] = []
  const monitor = new LinuxMonitor(
    async (command) => {
      if (command === commands.os) return 'Linux'
      if (command === commands.temperatures) return new Promise<string>(() => {})
      if (command === commands.fast)
        return '__TERMINAL_CPU__\ncpu 1 0 0 9\n__TERMINAL_MEM__\nMemTotal: 100 kB\nMemAvailable: 50 kB\n__TERMINAL_UPTIME__\n1 0'
      throw new Error('unavailable')
    },
    { now: () => Date.now(), currentUser: 'alice' },
  )
  monitor.subscribe((s) => snapshots.push(s))
  monitor.start()
  await vi.advanceTimersByTimeAsync(701)
  expect(snapshots.at(-1)?.temperatures?.status).toBe('unavailable')
  expect(snapshots.at(-1)?.ram.status).toBe('ok')
  expect(snapshots.at(-1)?.users?.value?.sessions[0].source).toBe('current-connection')
  monitor.close()
})
