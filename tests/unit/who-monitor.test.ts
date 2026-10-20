import { afterEach, expect, it, vi } from 'vitest'
import { LinuxMonitor } from '../../src/main/monitoring/LinuxMonitor'
import { commands } from '../../src/main/monitoring/commands'
import type { MetricSnapshot } from '../../src/shared/contracts'
afterEach(() => vi.useRealTimers())
it('bounds stalled who and keeps RAM sampling, retries users only every thirty seconds', async () => {
  vi.useFakeTimers()
  let usersCalls = 0
  let signal: AbortSignal | undefined
  const snapshots: MetricSnapshot[] = []
  const monitor = new LinuxMonitor(
    async (command, abort) => {
      if (command === commands.os) return 'Linux'
      if (command === commands.users) {
        usersCalls++
        signal = abort
        return new Promise<string>(() => {})
      }
      if ([commands.loginSessions, commands.processSessions, commands.system].includes(command))
        throw new Error('unavailable')
      if (command === commands.disks)
        return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 100 50 50 50% /'
      return '__TERMINAL_MEM__\nMemTotal: 1000 kB\nMemAvailable: 500 kB\n__TERMINAL_UPTIME__\n100 0'
    },
    { now: () => Date.now() },
  )
  monitor.subscribe((s) => snapshots.push(s))
  monitor.start()
  await vi.advanceTimersByTimeAsync(2000)
  expect(signal?.aborted).toBe(true)
  expect(snapshots.at(-1)?.users?.status).toBe('unavailable')
  expect(snapshots.at(-1)?.ram.status).toBe('ok')
  await vi.advanceTimersByTimeAsync(25000)
  expect(snapshots.length).toBeGreaterThan(5)
  expect(usersCalls).toBe(1)
  await vi.advanceTimersByTimeAsync(5000)
  expect(usersCalls).toBe(2)
  monitor.close()
})
