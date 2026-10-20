// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Updates } from '../../src/renderer/src/features/settings/Updates'
import type { Settings, UpdateStatus } from '../../src/shared/contracts'

afterEach(cleanup)
const settings = { updateChannel: 'stable' } as Settings
function setup(initial: UpdateStatus) {
  let notify!: (status: UpdateStatus) => void
  const updates = {
    status: vi.fn(async () => initial),
    check: vi.fn(async () => ({
      ...initial,
      state: 'available' as const,
      version: '0.2.0-alpha.1',
    })),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    onStatus: vi.fn((listener: typeof notify) => {
      notify = listener
      return vi.fn()
    }),
  }
  const update = vi.fn(async (patch: Partial<Settings>) => ({ ...settings, ...patch }))
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { updates, settings: { update } },
  })
  return { updates, update, notify: (status: UpdateStatus) => act(() => notify(status)) }
}

it('checks, displays download progress and installs only after explicit action', async () => {
  const initial: UpdateStatus = {
    state: 'idle',
    currentVersion: '0.1.0-alpha.1',
    channel: 'stable',
  }
  const api = setup(initial)
  render(<Updates settings={settings} onSaved={vi.fn()} />)
  await screen.findByText('Установлена 0.1.0-alpha.1')
  fireEvent.click(screen.getByRole('button', { name: /Проверить обновления/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Скачать обновление/ }))
  expect(api.updates.download).toHaveBeenCalledTimes(1)
  api.notify({ ...initial, state: 'downloading', percent: 42 })
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('42')
  api.notify({ ...initial, state: 'downloaded', version: '0.2.0-alpha.1' })
  expect(api.updates.install).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Перезапустить и установить' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Перезапустить и установить' }))
  expect(api.updates.install).toHaveBeenCalledTimes(1)
})

it('persists the selected release channel immediately', async () => {
  const api = setup({ state: 'idle', currentVersion: '0.1.0-alpha.1', channel: 'stable' })
  const onSaved = vi.fn()
  render(<Updates settings={settings} onSaved={onSaved} />)
  await screen.findByText('Установлена 0.1.0-alpha.1')
  fireEvent.change(screen.getByLabelText('Канал обновлений'), { target: { value: 'prerelease' } })
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ updateChannel: 'prerelease' }))
  expect(api.update).toHaveBeenCalledWith({ updateChannel: 'prerelease' })
})

it('explains why unpacked builds cannot update and offers no install action', async () => {
  const api = setup({
    state: 'disabled',
    currentVersion: '0.1.0-alpha.1',
    channel: 'stable',
    message: 'Проверка обновлений доступна после установки приложения.',
  })
  render(<Updates settings={settings} onSaved={vi.fn()} />)
  await screen.findByText('Проверка обновлений доступна после установки приложения.')
  expect(
    (screen.getByRole('button', { name: /Проверить обновления/ }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(api.updates.check).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})
