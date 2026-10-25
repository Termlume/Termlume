// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { X11Settings } from '../../src/renderer/src/features/settings/X11Settings'
import { Workspace } from '../../src/renderer/src/app/Workspace'
import type { Settings } from '../../src/shared/contracts'

afterEach(cleanup)

it('shows system display status without Windows X11 controls on Linux', async () => {
  Object.assign(window, {
    terminalApi: {
      platform: 'linux',
      x11: {
        status: vi.fn().mockResolvedValue({ state: 'running', available: true, activeSessions: 1 }),
      },
    },
  })
  render(<X11Settings settings={{} as Settings} onSaved={vi.fn()} />)
  expect(await screen.findByText(/SSH-сеансов: 1/)).toBeTruthy()
  expect(screen.getByText(/DISPLAY и Xauthority/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Запустить' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Остановить' })).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
})

it('hides the WSL welcome action on Linux', () => {
  Object.assign(window, { terminalApi: { platform: 'linux' } })
  render(<Workspace onNew={vi.fn()} onWsl={vi.fn()} />)
  expect(screen.queryByText(/WSL/)).toBeNull()
})
