// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Settings } from '../../src/shared/contracts'

vi.mock('../../src/renderer/src/app/Shell', () => ({
  Shell: ({ onSettings, children }: { onSettings: () => void; children: React.ReactNode }) => (
    <div>
      <button onClick={onSettings}>Open settings</button>
      {children}
    </div>
  ),
}))
vi.mock('../../src/renderer/src/features/hosts/useHosts', () => ({
  useHosts: () => ({ hosts: [], save: vi.fn(), remove: vi.fn() }),
  filterHosts: (hosts: unknown[]) => hosts,
}))
vi.mock('../../src/renderer/src/features/sessions/useSessions', () => ({
  useSessions: () => ({
    tabs: [],
    active: undefined,
    output: {},
    challenges: [],
    setChallenges: vi.fn(),
    setActive: vi.fn(),
    open: vi.fn(),
    openLocal: vi.fn(),
    reconnect: vi.fn(),
    close: vi.fn(),
  }),
}))
vi.mock('../../src/renderer/src/features/hosts/HostList', () => ({ HostList: () => null }))
vi.mock('../../src/renderer/src/features/hosts/HostEditor', () => ({ HostEditor: () => null }))
vi.mock('../../src/renderer/src/features/hosts/QuickConnect', () => ({ QuickConnect: () => null }))
vi.mock('../../src/renderer/src/features/sessions/Tabs', () => ({
  Tabs: () => null,
  stateLabels: {},
}))
vi.mock('../../src/renderer/src/features/terminal/TerminalView', () => ({
  TerminalView: () => null,
}))
vi.mock('../../src/renderer/src/features/sessions/AuthDialog', () => ({ AuthDialog: () => null }))
vi.mock('../../src/renderer/src/features/sessions/HostKeyDialog', () => ({
  HostKeyDialog: () => null,
}))
vi.mock('../../src/renderer/src/features/sftp/Browser', () => ({ SftpBrowser: () => null }))
vi.mock('../../src/renderer/src/features/sftp/Transfers', () => ({ Transfers: () => null }))
vi.mock('../../src/renderer/src/features/monitoring/MonitoringPanel', () => ({
  MonitoringPanel: () => null,
}))
vi.mock('../../src/renderer/src/app/Workspace', () => ({ Workspace: () => null }))
vi.mock('../../src/renderer/src/features/workspace/SplitWorkspace', () => ({
  SplitWorkspace: () => null,
}))
vi.mock('../../src/renderer/src/app/ResizeHandle', () => ({ ResizeHandle: () => null }))
vi.mock('../../src/renderer/src/features/settings/KeyboardShortcutsDialog', () => ({
  KeyboardShortcutsDialog: () => null,
}))
vi.mock('../../src/renderer/src/features/hosts/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../../src/renderer/src/app/Sidebar', () => ({ Sidebar: () => null }))

afterEach(cleanup)

it('opening settings preserves the already applied theme', async () => {
  const settings: Settings = {
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
  const update = vi.fn(async (patch: Partial<Settings>) => ({ ...settings, ...patch }))
  Object.assign(window, {
    terminalApi: {
      settings: { get: async () => settings, update },
      app: { onNotice: () => () => {}, onShortcut: () => () => {} },
    },
  })
  const { default: App } = await import('../../src/renderer/src/app/App')
  render(<App />)
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('tokyo-night'))
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Внешний вид' })).toBeTruthy())
  expect(document.documentElement.dataset.theme).toBe('tokyo-night')
  expect(update).not.toHaveBeenCalled()
})
