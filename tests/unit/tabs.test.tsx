// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tabs } from '../../src/renderer/src/features/sessions/Tabs'
import type { HostProfile } from '../../src/shared/contracts'

afterEach(cleanup)

it('dismisses the tab menu on Escape and outside pointer input', () => {
  render(
    <>
      <Tabs tabs={[]} onSelect={() => {}} onClose={() => {}} onNew={() => {}} />
      <button>Settings outside menu</button>
    </>,
  )
  const trigger = screen.getByRole('button', {
    name: /локальная консоль, избранное и подключение/i,
  })
  fireEvent.click(trigger)
  expect(screen.queryByRole('menu')).not.toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(trigger)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Settings outside menu' }))
  expect(screen.queryByRole('menu')).toBeNull()
})

it('opens the configured local shell directly from the plus button', () => {
  const onOpenLocal = vi.fn()
  render(
    <Tabs
      tabs={[]}
      onSelect={() => {}}
      onClose={() => {}}
      onNew={() => {}}
      onOpenLocal={onOpenLocal}
      defaultLocalShell="cmd"
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Новая вкладка' }))

  expect(onOpenLocal).toHaveBeenCalledWith('cmd')
})

it('offers local shells, favorite hosts, and normal connection creation from new tab menu', () => {
  const host = {
      id: 'favorite',
      name: 'Router',
      group: '',
      favorite: true,
      protocol: 'telnet',
      host: '10.0.0.1',
      port: 23,
      encoding: 'utf8',
    } as HostProfile,
    onOpenLocal = vi.fn(),
    onOpenHost = vi.fn(),
    onNew = vi.fn()
  render(
    <Tabs
      tabs={[]}
      onSelect={() => {}}
      onClose={() => {}}
      onNew={onNew}
      favorites={[host]}
      onOpenHost={onOpenHost}
      onOpenLocal={onOpenLocal}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }),
  )
  expect(screen.getByText('Локальная консоль, избранное или новое подключение')).not.toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'PowerShell · по умолчанию' }))
  expect(onOpenLocal).toHaveBeenCalledWith('powershell')
  fireEvent.click(
    screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }),
  )
  fireEvent.click(screen.getByRole('menuitem', { name: 'Router' }))
  expect(onOpenHost).toHaveBeenCalledWith(host)
  fireEvent.click(
    screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }),
  )
  fireEvent.click(screen.getByRole('menuitem', { name: 'Новое подключение…' }))
  expect(onNew).toHaveBeenCalledOnce()
})

it('offers Linux shells and normalizes a migrated Windows default', () => {
  const previous = window.terminalApi
  Object.assign(window, { terminalApi: { platform: 'linux' } })
  try {
    const onOpenLocal = vi.fn()
    render(
      <Tabs
        tabs={[]}
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
        onOpenLocal={onOpenLocal}
        defaultLocalShell="powershell"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Новая вкладка' }))
    expect(onOpenLocal).toHaveBeenCalledWith('system')
    fireEvent.click(
      screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }),
    )
    expect(screen.queryByRole('menuitem', { name: /PowerShell|Command Prompt/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zsh' }))
    expect(onOpenLocal).toHaveBeenCalledWith('zsh')
  } finally {
    Object.assign(window, { terminalApi: previous })
  }
})
