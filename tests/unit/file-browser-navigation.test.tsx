// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SftpBrowser } from '../../src/renderer/src/features/sftp/Browser'
import { terminalDirectoryPath } from '../../src/renderer/src/features/sftp/terminal-directory'
afterEach(cleanup)
const entry = { name: 'a.txt', type: 'file', size: 1, modifiedAt: 0, isSymlink: false }
function fixture() {
  const enqueue = vi.fn(async () => 'id'),
    destination = vi.fn(async () => 'C:\\Picked')
  const list = vi.fn(async ({ side, path }: { side: string; path: string }) => {
    if (path === '/denied') throw new Error('Permission denied')
    return {
      path: side === 'local' ? 'C:\\Visible' : path === '.' ? '/home/user' : path,
      entries: [entry],
      mode: side === 'local' ? 'local' : 'sftp',
      capabilities: { download: true, upload: true },
    }
  })
  Object.assign(window, {
    terminalApi: {
      files: {
        localRoot: async () => 'C:\\Visible',
        list,
        enqueue,
        downloadDestination: destination,
      },
    },
  })
  return { list, enqueue, destination }
}
it.each([
  ['remote-only', false, false],
  ['remote-only', true, false],
  ['two-panel', false, true],
  ['two-panel', true, false],
] as const)('download button matrix %s ask=%s', async (mode, ask, direct) => {
  const { destination, enqueue } = fixture()
  render(<SftpBrowser sessionId="session" mode={mode} askDownloadDirectory={ask} />)
  await screen.findByDisplayValue('/home/user')
  expect(!!screen.queryByRole('button', { name: 'Скачать', exact: true })).toBe(direct)
  const picker = screen.getByRole('button', {
    name: 'Скачать в…',
    exact: true,
  }) as HTMLButtonElement
  expect(picker.disabled).toBe(true)
  fireEvent.click(screen.getAllByText('a.txt').at(-1)!)
  if (direct) {
    fireEvent.click(screen.getByRole('button', { name: 'Скачать', exact: true }))
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'C:\\Visible\\a.txt' }),
      ),
    )
    expect(destination).not.toHaveBeenCalled()
  }
  fireEvent.click(picker)
  await waitFor(() => expect(destination).toHaveBeenCalledWith(true))
  await waitFor(() =>
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ target: 'C:\\Picked\\a.txt' })),
  )
})
it('follows actual cwd changes, preserves manual navigation, handles denied paths and re-enabling', async () => {
  const { list } = fixture()
  const view = render(
    <SftpBrowser sessionId="session" followTerminalDirectory terminalDirectory="~/logs" />,
  )
  await screen.findByDisplayValue('/home/user/logs')
  const path = screen.getByDisplayValue('/home/user/logs')
  fireEvent.change(path, { target: { value: '/manual' } })
  fireEvent.submit(path.closest('form')!)
  await screen.findByDisplayValue('/manual')
  view.rerender(
    <SftpBrowser
      sessionId="session"
      followTerminalDirectory
      terminalDirectory="~/logs"
      refreshToken={1}
    />,
  )
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/manual' })),
  )
  view.rerender(
    <SftpBrowser sessionId="session" followTerminalDirectory terminalDirectory="/denied" />,
  )
  await screen.findByText('Error: Permission denied')
  expect(screen.getByDisplayValue('/manual')).toBeTruthy()
  view.rerender(
    <SftpBrowser
      sessionId="session"
      followTerminalDirectory={false}
      terminalDirectory="/home/user/next"
    />,
  )
  expect(screen.getByDisplayValue('/manual')).toBeTruthy()
  view.rerender(
    <SftpBrowser sessionId="session" followTerminalDirectory terminalDirectory="/home/user/next" />,
  )
  await screen.findByDisplayValue('/home/user/next')
})
it('converts validated POSIX, WSL and Windows paths without accepting control characters', () => {
  expect(terminalDirectoryPath('~', '/', 'sftp')).toBe('/')
  expect(terminalDirectoryPath('~', 'C:\\', 'local')).toBe('C:\\')
  expect(terminalDirectoryPath('~/logs', '/home/user', 'sftp')).toBe('/home/user/logs')
  expect(terminalDirectoryPath('/var/log', '\\\\wsl.localhost\\Ubuntu\\home\\user', 'wsl')).toBe(
    '\\\\wsl.localhost\\Ubuntu\\var\\log',
  )
  expect(terminalDirectoryPath('~/logs', '\\\\wsl.localhost\\Ubuntu\\home\\user', 'wsl')).toBe(
    '\\\\wsl.localhost\\Ubuntu\\home\\user\\logs',
  )
  expect(terminalDirectoryPath('C:\\Users\\user', 'C:\\Users\\user', 'local')).toBe(
    'C:\\Users\\user',
  )
  for (const input of ['relative/path', '/bad\npath', 'https://host/path'])
    expect(terminalDirectoryPath(input, '/home/user', 'sftp')).toBeUndefined()
  expect(terminalDirectoryPath('\\\\?\\C:\\secret', 'C:\\Users', 'local')).toBeUndefined()
})
