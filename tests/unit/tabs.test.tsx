// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tabs } from '../../src/renderer/src/features/sessions/Tabs'
import type { HostProfile } from '../../src/shared/contracts'

afterEach(cleanup)

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
  fireEvent.click(screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }))
  expect(screen.getByText('Локальная консоль, избранное или новое подключение')).not.toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'PowerShell · по умолчанию' }))
  expect(onOpenLocal).toHaveBeenCalledWith('powershell')
  fireEvent.click(screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Router' }))
  expect(onOpenHost).toHaveBeenCalledWith(host)
  fireEvent.click(screen.getByRole('button', { name: /локальная консоль, избранное и подключение/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Новое подключение…' }))
  expect(onNew).toHaveBeenCalledOnce()
})
