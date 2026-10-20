import { afterEach, expect, it, vi } from 'vitest'
import { LinuxMonitor } from '../../src/main/monitoring/LinuxMonitor'
import { commands } from '../../src/main/monitoring/commands'
import { parseProcessSessions, parseSystem } from '../../src/main/monitoring/linux-parsers'
import type { MetricSnapshot } from '../../src/shared/contracts'
afterEach(() => vi.useRealTimers())
const fast =
  '__TERMINAL_CPU__\ncpu 1 0 0 9\n__TERMINAL_MEM__\nMemTotal: 100 kB\nMemAvailable: 50 kB\n__TERMINAL_UPTIME__\n1 0'
async function sample(replies: Record<string, string>, currentUser?: string) {
  vi.useFakeTimers()
  const snapshots: MetricSnapshot[] = []
  const calls: string[] = []
  const monitor = new LinuxMonitor(
    async (command) => {
      calls.push(command)
      if (command === commands.os) return 'Linux'
      if (command === commands.fast) return fast
      if (command in replies) return replies[command]
      throw new Error('source unavailable')
    },
    { currentUser },
  )
  monitor.subscribe((s) => snapshots.push(s))
  monitor.start()
  await vi.advanceTimersByTimeAsync(0)
  monitor.close()
  return { snapshot: snapshots.at(-1)!, calls }
}
it('keeps who primary and falls back to loginctl only when utmp is empty', async () => {
  const normal = await sample({ [commands.users]: 'alice pts/0 2026-10-20 10:01' })
  expect(normal.calls).not.toContain(commands.loginSessions)
  expect(normal.snapshot.users?.value?.sessions[0].source).toBe('who')
  const fallback = await sample({
    [commands.users]: '',
    [commands.loginSessions]: 'Name=bob\nTTY=pts/3\nClass=user\nState=active\n__SESSION_END__',
  })
  expect(fallback.snapshot.users?.value?.sessions).toEqual([
    { user: 'bob', terminal: 'pts/3', source: 'loginctl' },
  ])
})
it('labels the authenticated connection honestly when all sources fail and preserves RAM', async () => {
  const { snapshot } = await sample({}, 'alice')
  expect(snapshot.ram.status).toBe('ok')
  expect(snapshot.users?.value?.sessions).toEqual([
    { user: 'alice', terminal: '', source: 'current-connection' },
  ])
})
it('deduplicates observed tty shells and ignores nonterminal or unrelated processes', () => {
  expect(
    parseProcessSessions(
      'alice pts/1 sshd: alice@pts/1\nalice pts/1 -bash\nroot ? sshd: listener\nbob pts/2 python worker.py',
    ),
  ).toEqual([{ user: 'alice', terminal: 'pts/1', source: 'process' }])
})
it('parses load process counts, file handles, TCP ports and NFS mounts independently', () => {
  const result = parseSystem(
    '__TERMINAL_LOAD__\n0.10 0.20 0.30 2/420 123\n__TERMINAL_PROCESSES__\nSs\nR+\nSl\nR\n__PS_OK__\n__TERMINAL_FILES__\n120 20 9999\n__TERMINAL_CONNECTIONS__\n0 0 [::1]:22 [::1]:40000\n0 0 10.0.0.1:22 10.0.0.2:50000\n__SS_OK__\n__TERMINAL_MOUNTS__\nserver:/data /mnt/data nfs4 rw 0 0\n/dev/sda / ext4 rw 0 0\n__MOUNTS_OK__',
  )
  expect(result.processes).toEqual({ running: 2, total: 4 })
  expect(result.fileDescriptors).toEqual({ allocated: 100, maximum: 9999 })
  expect(result.connections).toMatchObject({ total: 2, ports: [{ port: 22, count: 2 }] })
  expect(result.nfsMounts).toEqual([{ source: 'server:/data', mount: '/mnt/data', type: 'nfs4' }])
  expect(parseSystem('__TERMINAL_LOAD__\n0.1 0.2 0.3 1/2').connections).toBeUndefined()
})

it('does not present loadavg task counts as process counts when ps fails', () => {
  const result = parseSystem(
    '__TERMINAL_LOAD__\n0.1 0.2 0.3 9/999 123\n__TERMINAL_PROCESSES__\nR\n',
  )
  expect(result.loadAverage).toEqual([0.1, 0.2, 0.3])
  expect(result.processes).toBeUndefined()
})

it('distinguishes unavailable mount data from a successful scan without NFS', () => {
  expect(parseSystem('__TERMINAL_MOUNTS__\n').nfsMounts).toBeUndefined()
  expect(
    parseSystem('__TERMINAL_MOUNTS__\n/dev/sda / ext4 rw 0 0\n__MOUNTS_OK__\n').nfsMounts,
  ).toEqual([])
})

it('keeps listeners and process details while counting only established TCP sessions', () => {
  const result = parseSystem(
    '__TERMINAL_CONNECTIONS__\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))\nESTAB 0 0 [::1]:22 [::1]:4567 users:(("sshd",pid=11,fd=4))\n__SS_OK__',
  )
  expect(result.connections).toMatchObject({
    total: 1,
    ports: [{ port: 22, count: 1 }],
    source: 'ss',
  })
  expect(result.connections?.details).toContain('LISTEN')
  expect(result.connections?.details).toContain('pid=11')
  const fallback = parseSystem(
    '__TERMINAL_CONNECTIONS__\ntcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN -\ntcp6 0 0 :::22 ::1:1234 ESTABLISHED 42/sshd\n__NETSTAT_OK__',
  )
  expect(fallback.connections).toMatchObject({
    total: 1,
    ports: [{ port: 22, count: 1 }],
    source: 'netstat',
  })
})
