import { it, expect, vi, afterEach } from 'vitest'
import { LinuxMonitor } from '../../src/main/monitoring/LinuxMonitor'
import { commands } from '../../src/main/monitoring/commands'
afterEach(() => vi.useRealTimers())
it('threeFailuresPausePolling', async () => {
  vi.useFakeTimers()
  let calls = 0
  const monitor = new LinuxMonitor(async () => {
    calls++
    throw new Error('denied')
  })
  let state = ''
  monitor.subscribe((snapshot) => {
    state = snapshot.state
  })
  monitor.start()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(6000)
  expect(calls).toBe(3)
  expect(state).toBe('paused')
  await vi.advanceTimersByTimeAsync(30000)
  expect(calls).toBe(3)
  monitor.close()
})
it('pollsNeverOverlap and pauseIgnoresLateSnapshot', async () => {
  vi.useFakeTimers()
  let release!: (value: string) => void,
    calls = 0,
    snapshots = 0
  const monitor = new LinuxMonitor(async () => {
    calls++
    return new Promise<string>((resolve) => {
      release = resolve
    })
  })
  monitor.subscribe(() => snapshots++)
  monitor.start()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(4000)
  expect(calls).toBe(1)
  monitor.pause()
  release('Linux')
  await vi.advanceTimersByTimeAsync(0)
  expect(snapshots).toBe(0)
  await vi.advanceTimersByTimeAsync(30000)
  expect(calls).toBe(1)
  monitor.close()
})
it('fastPollsEveryThreeSecondsAndDisksEveryThirty', async () => {
  vi.useFakeTimers()
  let fast = 0,
    disks = 0
  const monitor = new LinuxMonitor(
    async (command) => {
      if (command === commands.os) return 'Linux'
      if (
        [
          commands.users,
          commands.loginSessions,
          commands.processSessions,
          commands.system,
          commands.temperatures,
        ].includes(command)
      )
        return ''
      if (command === commands.disks) {
        disks++
        return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 100 50 50 50% /'
      }
      fast++
      return (
        '__TERMINAL_CPU__\ncpu ' +
        fast * 10 +
        ' 0 0 ' +
        fast * 90 +
        ' 0 0 0 0\n__TERMINAL_MEM__\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n__TERMINAL_NET__\neth0: ' +
        fast * 100 +
        ' 0 0 0 0 0 0 0 ' +
        fast * 200 +
        ' 0 0 0 0 0 0 0\n__TERMINAL_UPTIME__\n100.0 0.0'
      )
    },
    { now: () => Date.now() },
  )
  monitor.start()
  await vi.advanceTimersByTimeAsync(30000)
  expect(fast).toBe(11)
  expect(disks).toBe(2)
  monitor.close()
})

it('applies interval changes to pending polls and preserves pause/retry behavior', async () => {
  vi.useFakeTimers()
  let calls = 0
  const monitor = new LinuxMonitor(
    async () => {
      calls++
      throw new Error('denied')
    },
    { now: () => Date.now() },
  )
  monitor.start()
  await vi.advanceTimersByTimeAsync(1000)
  expect(calls).toBe(1)
  monitor.setInterval(5)
  await vi.advanceTimersByTimeAsync(3999)
  expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toBe(2)
  monitor.setInterval(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(calls).toBe(3)
  monitor.setInterval(10)
  await vi.advanceTimersByTimeAsync(30000)
  expect(calls).toBe(3)
  monitor.retry()
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toBe(4)
  await vi.advanceTimersByTimeAsync(10000)
  expect(calls).toBe(5)
  monitor.close()
})
