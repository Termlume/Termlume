// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { MonitoringBar } from '../../src/renderer/src/features/monitoring/MonitoringBar'
import type { MetricSnapshot } from '../../src/shared/contracts'
afterEach(cleanup)
const snapshot = {
  state: 'sampling',
  sampledAt: 100,
  history: [{ sampledAt: 100, cpuPercent: 24 }],
  cpuPercent: { status: 'ok', value: 24 },
  ram: { status: 'ok', value: { used: 3, total: 8, available: 5, cached: 2, buffers: 1 } },
  network: { status: 'ok', value: { rx: 10, tx: 20, interfaces: [] } },
  uptime: { status: 'ok', value: 90 },
  users: {
    status: 'ok',
    value: {
      sessions: [
        { user: 'alice', terminal: 'pts/0', source: 'who' },
        { user: 'bob', terminal: 'pts/1' },
      ],
    },
  },
  disks: {
    status: 'ok',
    value: ['/', '/home', '/tmp'].map((mount) => ({
      mount,
      device: '/dev/test',
      total: 100,
      used: 20,
      available: 80,
      percent: 20,
    })),
  },
} as MetricSnapshot
it('shows user names and each mount separately without an expand-all action', () => {
  render(<MonitoringBar snapshot={snapshot} server="Linux" />)
  expect(screen.getByRole('button', { name: /Пользователи: alice, bob/ })).toBeDefined()
  for (const mount of ['/', '/home', '/tmp'])
    expect(screen.getByRole('button', { name: `${mount}: 20%` })).toBeDefined()
  expect(screen.queryByText(/Подробности/)).toBeNull()
})
it('opens only the focused metric, updates it without closing and dismisses with Escape', () => {
  const view = render(<MonitoringBar snapshot={snapshot} server="Linux" />)
  const cpu = screen.getByRole('button', { name: /CPU:/ })
  fireEvent.focus(cpu)
  expect(
    within(screen.getByRole('tooltip')).getByRole('img', { name: /Загрузка CPU/ }),
  ).toBeDefined()
  expect(within(screen.getByRole('tooltip')).queryByText('pts/0')).toBeNull()
  view.rerender(<MonitoringBar snapshot={{ ...snapshot, sampledAt: 200 }} server="Linux" />)
  expect(screen.getByRole('tooltip')).toBeDefined()
  fireEvent.keyDown(cpu, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(screen.getByRole('button', { name: /Пользователи:/ }))
  expect(within(screen.getByRole('tooltip')).getByText('pts/0')).toBeDefined()
  expect(within(screen.getByRole('tooltip')).getAllByText('who')).toHaveLength(2)
})
it('offers optional metrics through the context menu', () => {
  const change = vi.fn()
  render(<MonitoringBar snapshot={snapshot} server="Linux" onVisibleItemsChange={change} />)
  fireEvent.contextMenu(screen.getByRole('toolbar'), { clientX: 20, clientY: 20 })
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Сетевые подключения' }))
  expect(change.mock.calls[0][0]).toContain('connections')
})
it('keeps the new tooltip open when the previous metric leave delay expires', () => {
  vi.useFakeTimers()
  try {
    render(<MonitoringBar snapshot={snapshot} server="Linux" />)
    const cpu = screen.getByRole('button', { name: /CPU:/ })
    fireEvent.mouseEnter(cpu)
    fireEvent.mouseLeave(cpu)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Пользователи:/ }))
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(200))
    expect(within(screen.getByRole('tooltip')).getByText('pts/0')).toBeDefined()
  } finally {
    vi.useRealTimers()
  }
})

it('uses metric icons and displays socket state and endpoint details on hover', () => {
  render(
    <MonitoringBar
      server="Linux"
      snapshot={{
        ...snapshot,
        system: {
          status: 'ok',
          value: {
            connections: {
              total: 1,
              ports: [{ port: 22, count: 1 }],
              source: 'ss',
              details: 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nESTAB 0 0 10.0.0.1:22 10.0.0.2:5000',
            },
          },
        },
      }}
      visibleItems={['cpu', 'connections', 'disks']}
    />,
  )
  const cpu = screen.getByRole('button', { name: 'CPU: 24.0%' })
  expect(cpu.querySelector('svg')).not.toBeNull()
  expect(cpu.textContent).not.toContain('CPU')
  expect(screen.getByRole('button', { name: '/home: 20%' }).textContent).not.toContain('Диск')
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Соединения: 1' }))
  expect(screen.getByRole('tooltip').textContent).toContain('0.0.0.0:22')
  expect(screen.getByRole('tooltip').textContent).toContain('LISTEN')
})
