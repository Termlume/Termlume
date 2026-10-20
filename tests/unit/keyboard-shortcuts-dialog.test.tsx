// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KeyboardShortcutsDialog } from '../../src/renderer/src/features/settings/KeyboardShortcutsDialog'

afterEach(cleanup)

it('lists the shared shortcut map and closes with Escape or the close action', () => {
  const onClose = vi.fn()
  render(<KeyboardShortcutsDialog onClose={onClose} />)
  const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' })
  for (const shortcut of [
    'Ctrl+W',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Ctrl+Shift+N',
    'Ctrl+Alt+T',
    'Ctrl+Alt+1',
    'Ctrl+Alt+2',
    'Ctrl+Alt+3',
    'Ctrl+Alt+4',
  ])
    expect(screen.getByText(shortcut)).not.toBeNull()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

it('captures a custom chord, saves it and resets to defaults', async () => {
  const onSave = vi.fn(async () => {}),
    onClose = vi.fn()
  const { unmount } = render(<KeyboardShortcutsDialog onClose={onClose} onSave={onSave} />)
  const closeShortcut = screen.getByRole('button', { name: 'Изменить: Закрыть активную вкладку' })
  fireEvent.click(closeShortcut)
  fireEvent.keyDown(closeShortcut, { key: 'Q', ctrlKey: true, shiftKey: true })
  expect(screen.getByText('Ctrl+Shift+Q')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ 'close-active': 'Ctrl+Shift+Q' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  unmount()
  render(
    <KeyboardShortcutsDialog
      onClose={onClose}
      onSave={onSave}
      bindings={{ 'close-active': 'Ctrl+Shift+Q' }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'По умолчанию' }))
  expect(screen.getByText('Ctrl+W')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({}))
})
it('blocks duplicate and terminal-reserved assignments before saving', () => {
  const onSave = vi.fn(async () => {})
  render(<KeyboardShortcutsDialog onClose={() => {}} onSave={onSave} />)
  const closeShortcut = screen.getByRole('button', { name: 'Изменить: Закрыть активную вкладку' })
  fireEvent.click(closeShortcut)
  fireEvent.keyDown(closeShortcut, { key: 'Tab', ctrlKey: true })
  expect(screen.getByRole('alert').textContent).toContain('уже используется')
  expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  fireEvent.click(closeShortcut)
  fireEvent.keyDown(closeShortcut, { key: 'c', ctrlKey: true })
  expect(screen.getByRole('alert').textContent).toContain('зарезервировано')
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(onSave).not.toHaveBeenCalled()
})
