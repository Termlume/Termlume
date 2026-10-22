// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  renderHook,
  act,
  waitFor,
} from '@testing-library/react'
import { MonitorItemsEditor } from '../../src/renderer/src/features/monitoring/MonitorItemsEditor'
import { MonitoringBar } from '../../src/renderer/src/features/monitoring/MonitoringBar'
import { useMonitorPreferences } from '../../src/renderer/src/features/monitoring/useMonitorPreferences'
import { hostSchema, settingsSchema } from '../../src/shared/schemas'
import type { HostProfile } from '../../src/shared/contracts'

afterEach(cleanup)
const profile = {
  id: 'a90d4d64-6ffb-4a13-a507-bc72539d268d',
  protocol: 'ssh',
  name: 'Linux',
  group: '',
  favorite: false,
  host: 'localhost',
  port: 22,
  username: 'alice',
  auth: 'password',
  monitoringEnabled: true,
} as HostProfile
it('validates ordered host and global selection, including intentionally empty selection', () => {
  expect(hostSchema.parse({ ...profile, monitoringItems: [] }).monitoringItems).toEqual([])
  expect(hostSchema.safeParse({ ...profile, monitoringItems: ['cpu', 'cpu'] }).success).toBe(false)
  expect(settingsSchema.safeParse({ monitoringItems: ['cpu', 'cpu'] }).success).toBe(false)
})
it('orders actual metric DOM in both placements and labels missing temperatures unavailable', () => {
  for (const expanded of [false, true]) {
    const view = render(
      <MonitoringBar server="Linux" expanded={expanded} visibleItems={['temperatures', 'cpu']} />,
    )
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.textContent!.indexOf('Недоступно')).toBeLessThan(
      toolbar.textContent!.indexOf('—'),
    )
    expect(toolbar.textContent).not.toContain('0.0°C')
    view.unmount()
  }
})
it('supports keyboard buttons, drag order and reset without enabling hidden items', () => {
  const change = vi.fn(),
    reset = vi.fn()
  render(<MonitorItemsEditor value={['cpu', 'ram']} onChange={change} onReset={reset} />)
  fireEvent.click(screen.getByRole('button', { name: 'Опустить: Процессор' }))
  expect(change).toHaveBeenLastCalledWith(['ram', 'cpu'])
  const setData = vi.fn()
  fireEvent.dragStart(screen.getByLabelText('Процессор').closest('.monitor-item-setting')!, {
    dataTransfer: { setData },
  })
  fireEvent.drop(screen.getByLabelText('Оперативная память').closest('.monitor-item-setting')!)
  expect(change).toHaveBeenLastCalledWith(['ram', 'cpu'])
  fireEvent.click(screen.getByText('Сбросить к общим настройкам'))
  expect(reset).toHaveBeenCalledOnce()
})
it('retains arrow focus after moving a keyed row, including the boundary, and toggles in place', () => {
  function Editor() {
    const [items, setItems] = useState<('cpu' | 'ram' | 'users')[]>(['cpu', 'ram', 'users'])
    return <MonitorItemsEditor value={items} onChange={(next) => setItems(next as typeof items)} />
  }
  render(<Editor />)
  const rows = () =>
    Array.from(document.querySelectorAll('[data-monitor-item]')).map((row) =>
      row.getAttribute('data-monitor-item'),
    )
  const down = screen.getByRole('button', { name: 'Опустить: Процессор' })
  down.focus()
  fireEvent.click(down)
  expect(document.activeElement).toBe(down)
  expect(rows().slice(0, 3)).toEqual(['ram', 'cpu', 'users'])
  fireEvent.click(down)
  expect(document.activeElement).toBe(down)
  expect(down.getAttribute('aria-disabled')).toBe('true')
  expect(down.hasAttribute('disabled')).toBe(false)
  const beforeToggle = rows()
  fireEvent.click(screen.getByLabelText('Оперативная память'))
  expect(rows()).toEqual(beforeToggle)
  fireEvent.click(screen.getByLabelText('Оперативная память'))
  expect(rows()).toEqual(beforeToggle)
  fireEvent.click(down)
  expect(rows()).toEqual(beforeToggle)
  expect(
    document
      .querySelector('.monitoring-editor-list')
      ?.contains(document.querySelector('.monitoring-editor-hint')),
  ).toBe(false)
})
it('keeps inline configuration out of both panels and retains the context menu', () => {
  for (const expanded of [false, true]) {
    const view = render(
      <MonitoringBar
        server="Linux"
        expanded={expanded}
        visibleItems={['cpu', 'ram']}
        onVisibleItemsChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Настроить показатели' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('toolbar'))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Температуры' })).toBeDefined()
    view.unmount()
  }
})
it('uses defaults for older profiles, persists host order using latest fields, and resets inheritance', async () => {
  let persisted = { ...profile, name: 'Latest name' }
  const save = vi.fn(async (next: HostProfile) => {
    persisted = next
    return next
  })
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { hosts: { list: async () => [persisted], save } },
  })
  const refresh = vi.fn(async () => {}),
    error = vi.fn()
  const hook = renderHook(() => useMonitorPreferences(profile, [profile], ['ram'], refresh, error))
  expect(hook.result.current.items).toEqual(['ram'])
  act(() => hook.result.current.change(['temperatures', 'cpu']))
  expect(hook.result.current.items).toEqual(['temperatures', 'cpu'])
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(persisted.name).toBe('Latest name')
  expect(hostSchema.parse(persisted).monitoringItems).toEqual(['temperatures', 'cpu'])
  act(() => hook.result.current.reset())
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(persisted.monitoringItems).toBeUndefined()
  expect(hook.result.current.items).toEqual(['ram'])
  expect(error).not.toHaveBeenCalled()
})
it('keeps temporary connections out of saved hosts and isolates overrides between hosts', () => {
  const save = vi.fn()
  Object.defineProperty(window, 'terminalApi', { configurable: true, value: { hosts: { save } } })
  const hook = renderHook(
    ({ host }) => useMonitorPreferences(host, [], ['cpu'], async () => {}, vi.fn()),
    { initialProps: { host: profile } },
  )
  act(() => hook.result.current.change([]))
  expect(hook.result.current.items).toEqual([])
  hook.rerender({ host: { ...profile, id: 'another' } })
  expect(hook.result.current.items).toEqual(['cpu'])
  hook.rerender({ host: profile })
  expect(hook.result.current.items).toEqual([])
  expect(save).not.toHaveBeenCalled()
})
