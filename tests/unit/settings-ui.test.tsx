// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Appearance } from '../../src/renderer/src/features/settings/Appearance'
import type { Settings } from '../../src/shared/contracts'
import { applyTheme } from '../../src/renderer/src/themes/apply-theme'

afterEach(cleanup)

it('keeps the active theme when opening and closing settings with a stale settings snapshot', () => {
  const saved = {
    themeId: 'catppuccin-mocha',
    terminalFont: 'Consolas, monospace',
    terminalFontSize: 14,
    sftpMode: 'two-panel',
    mouseAction: 'select-copy-right-paste',
    localShell: 'powershell',
    smoothInput: false,
  } as Settings
  const update = vi.fn()
  Object.assign(window, { terminalApi: { settings: { update } } })
  applyTheme('tokyo-night')

  render(<Appearance settings={saved} onSaved={vi.fn()} onClose={vi.fn()} />)

  expect(document.documentElement.dataset.theme).toBe('tokyo-night')
  expect(screen.getByRole('button', { name: 'Tokyo Night' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  fireEvent.click(screen.getByRole('button', { name: 'One Dark' }))
  expect(document.documentElement.dataset.theme).toBe('one-dark')
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(document.documentElement.dataset.theme).toBe('tokyo-night')
  expect(update).not.toHaveBeenCalled()
})

it('savesInteractionPreferencesFromAppearanceSettings', async () => {
  const saved: Settings = {
    themeId: 'tokyo-night',
    terminalFont: 'Consolas, monospace',
    terminalFontSize: 14,
    sidebarWidth: 260,
    monitorWidth: 280,
    sftpHeight: 300,
    windowBounds: { width: 1440, height: 900 },
    sftpMode: 'two-panel',
    mouseAction: 'select-copy-right-paste',
    localShell: 'powershell',
    smoothInput: false,
  }
  const update = vi.fn(async (patch: Partial<Settings>) => Object.assign(saved, patch))
  Object.assign(window, { terminalApi: { settings: { update } } })
  const onSaved = vi.fn()
  render(<Appearance settings={saved} onSaved={onSaved} onClose={() => {}} />)

  fireEvent.change(screen.getByLabelText('Режим файлового браузера'), {
    target: { value: 'remote-only' },
  })
  fireEvent.change(screen.getByLabelText('Действия мыши в терминале'), {
    target: { value: 'manual' },
  })
  fireEvent.change(screen.getByLabelText('Локальная оболочка по умолчанию'), {
    target: { value: 'cmd' },
  })
  fireEvent.click(screen.getByLabelText('Плавная отправка текста'))
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(saved).toMatchObject({
    themeId: 'tokyo-night',
    sftpMode: 'remote-only',
    mouseAction: 'manual',
    localShell: 'cmd',
    smoothInput: true,
  })
})
