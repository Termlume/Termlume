import { afterEach, describe, it, expect, vi } from 'vitest'
import { SessionManager } from '../../src/main/sessions/SessionManager'
import { OutputBuffer } from '../../src/main/sessions/OutputBuffer'
import type { AdapterEvent, HostProfile, SessionEvent } from '../../src/shared/contracts'

afterEach(() => vi.useRealTimers())

class FakeAdapter {
  listeners = new Set<(event: AdapterEvent) => void>()
  writes: string[] = []
  closes = 0
  connect = async (_signal: AbortSignal) => {}
  write(data: string) {
    this.writes.push(data)
  }
  resize() {}
  pauseOutput() {}
  resumeOutput() {}
  async close() {
    this.closes++
  }
  subscribe(listener: (event: AdapterEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(event: AdapterEvent) {
    this.listeners.forEach((fn) => fn(event))
  }
}
const profile = {
  id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
  name: 'server',
  protocol: 'ssh',
  host: 'localhost',
  port: 22,
  username: 'user',
  auth: 'password',
  favorite: false,
  group: '',
  monitoringEnabled: false,
} as HostProfile

it('reports actual cwd with effective shared username and preserves output bytes and ACK sequencing', async () => {
  vi.useFakeTimers()
  const adapter = Object.assign(new FakeAdapter(), { cwdUsername: 'shvv' })
  const events: SessionEvent[] = []
  const manager = new SessionManager(
    () => adapter,
    (_owner, event) => events.push(event),
  )
  const id = await manager.open(1, profile)
  await vi.advanceTimersByTimeAsync(0)
  const output = Buffer.from('shvv@server:/home/shvv$ ')
  adapter.emit({ type: 'data', data: output })
  await vi.advanceTimersByTimeAsync(121)
  expect(events.filter((event) => event.type === 'cwd').map((event) => event.path)).toEqual([
    '/home/shvv',
  ])
  const firstData = events.find((event) => event.type === 'data')!
  expect(firstData.type === 'data' ? [...firstData.data] : []).toEqual([...output])
  manager.ack(1, id, firstData.sequence)
  manager.write(1, id, 'cd /tmp\r')
  const osc = Buffer.from('\x1b]7;file:///tmp\x07')
  adapter.emit({ type: 'data', data: osc })
  await vi.advanceTimersByTimeAsync(16)
  const data = events.filter((event) => event.type === 'data')
  expect(data.map((event) => Buffer.from(event.data).toString())).toEqual([
    output.toString(),
    osc.toString(),
  ])
  expect(events.filter((event) => event.type === 'cwd').map((event) => event.path)).toEqual([
    '/home/shvv',
    '/tmp',
  ])
  manager.ack(1, id, data.at(-1)!.sequence)
  expect(
    events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence),
  ).toBe(true)
  expect(adapter.writes).toEqual(['cd /tmp\r'])
  await manager.closeOwner(1)
})

describe('SessionManager', () => {
  it('foreignOwnerCannotWrite', async () => {
    const adapter = new FakeAdapter()
    const manager = new SessionManager(
      () => adapter,
      () => {},
    )
    const id = await manager.open(1, profile)
    expect(() => manager.write(2, id, 'secret')).toThrow('forbidden')
    expect(adapter.writes).toEqual([])
    await manager.closeOwner(1)
  })
  it('lateConnectAfterCloseStaysClosed', async () => {
    const adapter = new FakeAdapter()
    let complete!: () => void
    adapter.connect = () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
    const events: SessionEvent[] = []
    const manager = new SessionManager(
      () => adapter,
      (_owner, event) => events.push(event),
    )
    const id = await manager.open(1, profile)
    await manager.close(1, id)
    complete()
    await Promise.resolve()
    expect(
      events.filter((event) => event.type === 'state' && event.state === 'connected'),
    ).toHaveLength(0)
    expect(adapter.closes).toBe(1)
  })
  it('ownerDestroyedDisposesAll', async () => {
    const adapters: FakeAdapter[] = []
    const manager = new SessionManager(
      () => {
        const adapter = new FakeAdapter()
        adapters.push(adapter)
        return adapter
      },
      () => {},
    )
    await manager.open(1, profile)
    await manager.open(1, profile)
    await manager.closeOwner(1)
    await manager.closeOwner(1)
    expect(adapters.map((adapter) => adapter.closes)).toEqual([1, 1])
    expect(manager.count(1)).toBe(0)
  })
  it('emits naturalExitToCloseOnlyItsTabAfterFinalOutputIsFlushed', async () => {
    vi.useFakeTimers()
    const adapters: FakeAdapter[] = [],
      events: SessionEvent[] = []
    const manager = new SessionManager(
      () => {
        const adapter = new FakeAdapter()
        adapters.push(adapter)
        return adapter
      },
      (_owner, event) => events.push(event),
    )
    const first = await manager.open(1, profile),
      second = await manager.open(1, profile)
    await Promise.resolve()
    adapters[0].emit({ type: 'data', data: new Uint8Array([65]) })
    adapters[0].emit({ type: 'closed', reason: 'remote-exit' } as unknown as AdapterEvent)
    await vi.advanceTimersByTimeAsync(16)
    const output = events.find((event) => event.type === 'data' && event.sessionId === first)
    if (output?.type === 'data') manager.ack(1, first, output.sequence)
    await vi.advanceTimersByTimeAsync(0)
    expect(events.some((event) => event.type === 'closed' && event.sessionId === first)).toBe(true)
    expect(events.some((event) => event.type === 'closed' && event.sessionId === second)).toBe(
      false,
    )
    expect(manager.count(1)).toBe(1)
    await manager.closeOwner(1)
    vi.useRealTimers()
  })
  it('drops a network adapter after marking the tab disconnected for explicit reconnect', async () => {
    const adapter = new FakeAdapter(),
      events: SessionEvent[] = []
    const manager = new SessionManager(
      () => adapter,
      (_owner, event) => events.push(event),
    )
    const id = await manager.open(1, profile)
    await Promise.resolve()
    adapter.emit({ type: 'closed', reason: 'transport' } as unknown as AdapterEvent)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.some((event) => event.type === 'state' && event.state === 'disconnected')).toBe(
      true,
    )
    expect(events.some((event) => event.type === 'closed' && event.sessionId === id)).toBe(false)
    expect(manager.count(1)).toBe(0)
    await manager.closeOwner(1)
  })
})
it('flushesFinalOutputBeforeDisposingNaturalClose', async () => {
  vi.useFakeTimers()
  try {
    const adapter = new FakeAdapter(),
      events: SessionEvent[] = []
    const manager = new SessionManager(
      () => adapter,
      (_owner, event) => events.push(event),
    )
    const id = await manager.open(1, profile)
    await Promise.resolve()
    adapter.emit({ type: 'data', data: new Uint8Array([65]) })
    adapter.emit({ type: 'closed' })
    await vi.advanceTimersByTimeAsync(16)
    const data = events.find((event) => event.type === 'data')
    expect(data?.type === 'data' ? [...data.data] : []).toEqual([65])
    if (data) manager.ack(1, id, data.sequence)
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.count(1)).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it('backpressure preserves order and bounds pending output', () => {
  vi.useFakeTimers()
  let paused = false
  let seq = 0
  const received: number[] = []
  const buffer = new OutputBuffer(
    (data) => {
      received.push(...data)
      return ++seq
    },
    () => {
      paused = true
    },
    () => {
      paused = false
    },
  )
  for (let i = 0; i < 16; i++) buffer.push(new Uint8Array(65536).fill(i))
  expect(paused).toBe(true)
  expect(buffer.pendingBytes).toBeLessThanOrEqual(1048576)
  for (let i = 0; i < 16; i++) {
    vi.advanceTimersByTime(16)
    buffer.ack(seq)
  }
  expect(received.length).toBe(1048576)
  expect(received[65536]).toBe(1)
  expect(paused).toBe(false)
  buffer.dispose()
  vi.useRealTimers()
})
