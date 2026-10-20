// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UpdateNotice } from '../../src/renderer/src/features/settings/UpdateNotice'
import {
  releaseNotesText,
  changelogVersion,
} from '../../src/renderer/src/features/settings/release-notes'
import type { Settings, UpdateStatus } from '../../src/shared/contracts'
afterEach(cleanup)
function setup(initial: UpdateStatus) {
  let listener = (_: UpdateStatus) => {}
  const update = vi.fn(async (patch: Partial<Settings>) => ({ ...patch }) as Settings)
  const api = {
    status: async () => initial,
    check: vi.fn(async () => initial),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    onStatus: (fn: typeof listener) => {
      listener = fn
      return () => {}
    },
  }
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { updates: api, settings: { update } },
  })
  return { api, update, emit: (value: UpdateStatus) => act(() => listener(value)) }
}
const available: UpdateStatus = {
  state: 'available',
  currentVersion: '0.1.0-alpha.3',
  channel: 'prerelease',
  version: '0.1.0-alpha.4',
  releaseNotes: '<h2>Исправлено</h2><ul><li>Перенос файлов</li></ul>',
}
it('offers each new version once and persists deferral while leaving manual access', async () => {
  const { update, emit } = setup(available)
  const modalChange = vi.fn()
  const view = render(<UpdateNotice settings={{} as Settings} onSaved={vi.fn()} onOpenChange={modalChange} />)
  await screen.findByRole('dialog')
  expect(modalChange).toHaveBeenLastCalledWith(true)
  expect(screen.getByText(/Перенос файлов/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Возможно позже' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({ dismissedUpdateVersion: available.version }),
  )
  expect(modalChange).toHaveBeenLastCalledWith(false)
  emit(available)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Обновления Termlume' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  view.unmount()
  render(
    <UpdateNotice
      settings={{ dismissedUpdateVersion: available.version } as Settings}
      onSaved={vi.fn()}
    />,
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Обновления Termlume' }).textContent).toContain(
      'обновление',
    ),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  emit({ ...available, version: '0.1.0-alpha.5' })
  expect(screen.getByRole('dialog')).toBeTruthy()
})
it('installs after the user accepts an update, but closing during download postpones installation', async () => {
  const { api } = setup(available)
  let finish!: () => void
  api.download.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  render(<UpdateNotice settings={{} as Settings} onSaved={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Обновить сейчас' }))
  expect(api.download).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Возможно позже' }))
  await act(async () => finish())
  expect(api.install).not.toHaveBeenCalled()
})
it('renders release notes as inert text and extracts version specific changelog', () => {
  expect(releaseNotesText('<h2>Fix</h2><script>bad()</script><li>A &amp; B</li>')).toContain(
    '• A & B',
  )
  expect(releaseNotesText('<script>bad()</script>')).not.toContain('bad')
  expect(changelogVersion('## Unreleased\nnext\n## 1.0\nfixed\n## 0.9\nold', '1.0')).toBe('fixed')
})
