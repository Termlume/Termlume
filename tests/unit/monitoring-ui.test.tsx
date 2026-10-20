// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, renderHook, act, screen, cleanup } from '@testing-library/react'
import { useMonitoring } from '../../src/renderer/src/features/monitoring/useMonitoring'
import { MetricCard } from '../../src/renderer/src/features/monitoring/MetricCard'
import { CapacityBar } from '../../src/renderer/src/features/monitoring/CapacityBar'
import {
  DiskCard,
  MonitoringPanel,
} from '../../src/renderer/src/features/monitoring/MonitoringPanel'
import { MonitoringService } from '../../src/main/monitoring/MonitoringService'
import type { MetricSnapshot, HostProfile } from '../../src/shared/contracts'
afterEach(cleanup)
function apiFixture() {
  const listeners = new Set<(event: { sessionId: string; snapshot: MetricSnapshot }) => void>(),
    calls: { id: string; visible: boolean }[] = []
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      monitoring: {
        setVisible: async (id: string, visible: boolean) => {
          calls.push({ id, visible })
        },
        retry: async () => {},
        onSnapshot: (listener: any) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  })
  return {
    calls,
    emit: (id: string, snapshot: MetricSnapshot) =>
      listeners.forEach((listener) => listener({ sessionId: id, snapshot })),
  }
}
const snapshot = { state: 'sampling', sampledAt: 100, history: [] } as MetricSnapshot
it('opensMonitoringForEverySSHSessionAndPausesWhenHidden', () => {
  let calls = 0
  const profile = { protocol: 'ssh', monitoringEnabled: false } as HostProfile
  const service = new MonitoringService(
    () => ({
      profile,
      exec: async () => {
        calls++
        return 'Linux'
      },
    }),
    () => {},
  )
  service.setVisible('one', true)
  expect(calls).toBeGreaterThan(0)
  const api = apiFixture()
  renderHook(() => useMonitoring('one', true, true))
  expect(api.calls).toEqual([{ id: 'one', visible: true }])
})
it('switchSessionIgnoresLateSnapshot', () => {
  const api = apiFixture(),
    hook = renderHook(({ id }) => useMonitoring(id, true, true), { initialProps: { id: 'one' } })
  act(() => api.emit('one', snapshot))
  expect(hook.result.current.snapshot?.sampledAt).toBe(100)
  hook.rerender({ id: 'two' })
  act(() => api.emit('one', { ...snapshot, sampledAt: 200 }))
  expect(hook.result.current.snapshot).toBeUndefined()
})
it('hiddenPanelPausesAndReopenResetsBaseline', () => {
  const api = apiFixture(),
    hook = renderHook(({ visible }) => useMonitoring('one', true, visible), {
      initialProps: { visible: true },
    })
  act(() => api.emit('one', snapshot))
  hook.rerender({ visible: false })
  expect(api.calls.at(-1)).toEqual({ id: 'one', visible: false })
  hook.rerender({ visible: true })
  expect(hook.result.current.snapshot).toBeUndefined()
})
it('unavailableIsNotZero', () => {
  render(
    createElement(MetricCard<number>, {
      label: 'CPU',
      metric: { status: 'unavailable', error: 'denied' },
      format: (value) => value.toFixed(0) + '%',
    }),
  )
  expect(screen.getByText('Недоступно')).toBeDefined()
  expect(screen.queryByText('0%')).toBeNull()
})

it('showsDiskCapacityAndAccessibleGreenAvailableRedUsedTrack', () => {
  render(
    createElement(DiskCard, {
      disks: {
        status: 'ok',
        value: [
          {
            device: '/dev/sda1',
            mount: '/',
            total: 100 * 1024 ** 3,
            used: 36 * 1024 ** 3,
            available: 64 * 1024 ** 3,
            percent: 36,
          },
        ],
      },
      sampledAt: 100,
    }),
  )
  expect(screen.getByText('36.0 GB / 100.0 GB')).toBeDefined()
  expect(screen.getByText('64.0 GB свободно')).toBeDefined()
  expect(screen.getByRole('img', { name: /занято 36%.*доступно 64%/i })).toBeDefined()
})

it('usesTheSameRedUsedGreenAvailableScaleForMemoryAndSwap', () => {
  for (const label of ['Оперативная память', 'Swap']) {
    const { container, unmount } = render(
      createElement(CapacityBar, {
        label,
        usage: { used: 3 * 1024 ** 3, available: 1024 ** 3, total: 4 * 1024 ** 3 },
      }),
    )
    expect(screen.queryByLabelText('Использование памяти')).toBeNull()
    expect(screen.getByRole('img', { name: 'Занято 75%, доступно 25%' })).toBeDefined()
    expect(screen.getByText('3.0 GB / 4.0 GB')).toBeDefined()
    expect(screen.getByText('1.0 GB свободно')).toBeDefined()
    expect((container.querySelector('.capacity-used') as HTMLElement).style.width).toBe('75%')
    expect((container.querySelector('.capacity-free') as HTMLElement).style.width).toBe('25%')
    unmount()
  }
})

it('doesNotShowUnavailableOrUnconfiguredCapacityAsFree', () => {
  const { rerender } = render(createElement(CapacityBar, { label: 'Swap' }))
  expect(screen.queryByRole('img')).toBeNull()
  for (const usage of [
    { total: 0, used: 0, available: 0 },
    { total: NaN, used: 0, available: 1 },
    { total: 100, used: -1, available: 100 },
  ]) {
    rerender(createElement(CapacityBar, { label: 'Swap', usage }))
    expect(screen.queryByRole('img')).toBeNull()
  }
})

it('doesNotMisrepresentReservedDiskSpaceAsAvailable', () => {
  render(
    createElement(CapacityBar, { label: 'Диск /', usage: { total: 100, used: 60, available: 35 } }),
  )
  expect(screen.getByRole('img', { name: 'Занято 60%, доступно 35%' })).toBeDefined()
  expect(screen.getByText('35 B свободно')).toBeDefined()
})

it('rendersMemoryAndSwapCapacityInTheLivePanelAndRemovesStaleUnavailableValues', () => {
  const api = apiFixture()
  render(
    createElement(MonitoringPanel, {
      sessionId: 'one',
      connected: true,
      profile: { protocol: 'ssh', name: 'Linux' } as HostProfile,
    }),
  )
  const metrics = {
    ...snapshot,
    ram: { status: 'ok', value: { used: 3, total: 4, available: 1 } },
    swap: { status: 'ok', value: { used: 2, total: 4, available: 2 } },
    network: { status: 'unavailable' },
    disks: { status: 'unavailable' },
    uptime: { status: 'unavailable' },
  } as MetricSnapshot
  act(() => api.emit('one', metrics))
  expect(screen.queryByLabelText('Использование памяти')).toBeNull()
  expect(screen.getByRole('img', { name: 'Занято 75%, доступно 25%' })).toBeDefined()
  expect(screen.getByRole('img', { name: 'Занято 50%, доступно 50%' })).toBeDefined()
  act(() =>
    api.emit('one', {
      ...metrics,
      ram: { ...metrics.ram, status: 'unavailable' },
      swap: { ...metrics.swap, status: 'unavailable' },
    }),
  )
  expect(screen.queryByRole('img', { name: /Занято/ })).toBeNull()
})
