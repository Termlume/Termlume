// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SftpBrowser } from '../../src/renderer/src/features/sftp/Browser'
import { HostEditor } from '../../src/renderer/src/features/hosts/HostEditor'
import { enqueueSelection } from '../../src/renderer/src/features/sftp/enqueue-selection'
import { hostSchema, settingsPatchSchema, settingsSchema } from '../../src/shared/schemas'

afterEach(cleanup)

it('creates SFTP and FTPS profiles using the corresponding connection fields', async () => {
  Object.defineProperty(window, 'terminalApi', { configurable: true, value: {} })
  const save = vi.fn(async () => {})
  const close = vi.fn()
  const view = render(<HostEditor quick onSave={save} onClose={close} />)
  fireEvent.change(screen.getByLabelText('Протокол'), { target: { value: 'sftp' } })
  fireEvent.change(screen.getByLabelText('Адрес сервера'), {
    target: { value: 'files.example.test' },
  })
  fireEvent.submit(screen.getByRole('dialog'))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'sftp',
        host: 'files.example.test',
        port: 22,
        username: 'root',
        auth: 'password',
      }),
      undefined,
    ),
  )
  view.unmount()
  render(<HostEditor quick onSave={save} onClose={close} />)
  fireEvent.change(screen.getByLabelText('Протокол'), { target: { value: 'ftp' } })
  fireEvent.change(screen.getByLabelText('Адрес сервера'), {
    target: { value: 'ftp.example.test' },
  })
  fireEvent.change(screen.getByLabelText('Защита соединения'), {
    target: { value: 'implicit-tls' },
  })
  fireEvent.submit(screen.getByRole('dialog'))
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        protocol: 'ftp',
        security: 'implicit-tls',
        port: 990,
        username: 'root',
      }),
      undefined,
    ),
  )
})

it('enqueues folders with the correct local and remote separators without dropping the selection', async () => {
  const enqueue = vi.fn(async () => 'transfer')
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { files: { enqueue } },
  })
  const folder = {
    name: 'backup',
    type: 'directory' as const,
    size: 0,
    modifiedAt: 0,
    isSymlink: false,
  }
  await enqueueSelection('file-session', 'upload', 'C:\\Users\\Demo', '/home/demo', [folder])
  expect(enqueue).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: 'C:\\Users\\Demo\\backup', target: '/home/demo/backup' }),
  )
  await enqueueSelection('file-session', 'download', '/home/demo', 'C:\\Downloads', [folder])
  expect(enqueue).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: '/home/demo/backup', target: 'C:\\Downloads\\backup' }),
  )
})

it('preserves old defaults and keeps independent settings patches empty', () => {
  expect(settingsSchema.parse({})).toMatchObject({
    monitoringPlacement: 'sidebar',
    connectionsCollapsed: false,
    collapsedHostGroups: [],
  })
  expect(settingsPatchSchema.parse({})).toEqual({})
  const profile = hostSchema.parse({
    id: crypto.randomUUID(),
    name: 'demo',
    protocol: 'telnet',
    host: 'demo.test',
    tags: [' Prod ', '#prod', 'api server'],
  })
  expect(profile.tags).toEqual(['prod', 'api-server'])
})

it('file tabs hide terminal actions and dismiss the portal menu on deactivation', async () => {
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Demo',
        list: async ({ side }: { side: string }) => ({
          path: side === 'local' ? 'C:\\Demo' : '/home/demo',
          mode: 'sftp',
          capabilities: { download: true },
          entries:
            side === 'local'
              ? []
              : [{ name: 'readme.txt', type: 'file', size: 12, modifiedAt: 1, isSymlink: false }],
        }),
      },
    },
  })
  const view = render(<SftpBrowser sessionId="session" terminalAvailable={false} active />)
  const row = (await screen.findByText('readme.txt')).closest('tr')!
  fireEvent.contextMenu(row)
  expect(screen.getByRole('menu')).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: 'Вставить путь в терминал' })).toBeNull()
  view.rerender(<SftpBrowser sessionId="session" terminalAvailable={false} active={false} />)
  expect(screen.queryByRole('menu')).toBeNull()
})
