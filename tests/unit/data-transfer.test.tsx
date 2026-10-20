// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DataTransfer } from '../../src/renderer/src/features/settings/DataTransfer'

afterEach(cleanup)

it('confirms export passphrase and previews conflicts before applying an import choice', async () => {
  const exportData = vi.fn(async () => {}),
    previewImport = vi.fn(async () => ({
      token: 'preview-token',
      hosts: 2,
      identities: 1,
      conflicts: { hosts: 1, identities: 0, knownHosts: 0 },
    })),
    commitImport = vi.fn(async () => ({}))
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { data: { export: exportData, previewImport, commitImport } },
  })
  render(createElement(DataTransfer))
  const [passphrase, confirmation] = screen.getAllByLabelText(/пароль/i)
  fireEvent.change(passphrase, { target: { value: 'correct-passphrase' } })
  fireEvent.change(confirmation, { target: { value: 'different-passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить архив' }))
  expect(screen.getByRole('alert').textContent).toContain('не совпадают')
  expect(exportData).not.toHaveBeenCalled()
  fireEvent.change(confirmation, { target: { value: 'correct-passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить архив' }))
  await waitFor(() => expect(exportData).toHaveBeenCalledWith('correct-passphrase'))
  fireEvent.change(passphrase, { target: { value: 'correct-passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: 'Открыть архив' }))
  await waitFor(() => expect(previewImport).toHaveBeenCalledWith('correct-passphrase'))
  expect(screen.getByText(/Совпадения ID: 1 подключений/)).toBeDefined()
  fireEvent.change(screen.getByRole('combobox', { name: 'Стратегия импорта' }), {
    target: { value: 'replace' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить импорт' }))
  await waitFor(() => expect(commitImport).toHaveBeenCalledWith('preview-token', 'replace'))
})
