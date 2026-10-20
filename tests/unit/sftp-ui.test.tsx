// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SftpBrowser } from '../../src/renderer/src/features/sftp/Browser'
import { Transfers } from '../../src/renderer/src/features/sftp/Transfers'
import type { FileActivity, TransferSnapshot } from '../../src/shared/contracts'

afterEach(cleanup)

it('offers editor modes, properties and explicit row rename from context menu', async () => {
  const openRemote = vi.fn(async () => ({ localPath: 'C:\\Temp\\config' }))
  const mutate = vi.fn(async () => {})
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        openRemote,
        mutate,
        list: async ({ side }: { side: string }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home',
          capabilities: { rename: true, remove: true, chmod: true, chown: true },
          entries:
            side === 'local'
              ? []
              : [
                  {
                    name: 'config',
                    type: 'file',
                    size: 99,
                    modifiedAt: 1,
                    owner: 'root',
                    group: 'admin',
                    permissions: 0o640,
                    isSymlink: false,
                  },
                ],
        }),
      },
    },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)
  const row = (await screen.findByText('config')).closest('tr')!
  fireEvent.contextMenu(row)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть с помощью…' }))
  await waitFor(() =>
    expect(openRemote).toHaveBeenCalledWith('session-id', '/home/config', 'choose'),
  )
  fireEvent.contextMenu(row)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Свойства' }))
  expect(screen.getByRole('dialog', { name: 'Свойства файла' }).textContent).toContain(
    '/home/config',
  )
  fireEvent.click(screen.getByRole('button', { name: 'ОК' }))
  fireEvent.contextMenu(row)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.contextMenu(row)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }))
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'updated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'rename', path: '/home/config', name: 'updated' }),
    ),
  )
})

it('keeps the last accessible folder and its rows when navigation is denied', async () => {
  const list = vi.fn(async ({ side, path }: { side: string; path: string }) => {
    if (path.endsWith('/private')) throw new Error('Permission denied')
    return {
      path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
      entries:
        side === 'local'
          ? []
          : [{ name: 'private', type: 'directory', size: 0, modifiedAt: 1, isSymlink: false }],
    }
  })
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { files: { localRoot: async () => 'C:\\Users\\tester', list } },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)
  fireEvent.doubleClick(await screen.findByText('private'))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText('private')).toBeTruthy()
  expect((screen.getByLabelText('Удалённый путь') as HTMLInputElement).value).toBe('/home/tester')
  fireEvent.click(screen.getByRole('button', { name: 'ОК' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('private')).toBeTruthy()
})

it('shows immediate opening progress, coalesces repeated opens and displays download bytes', async () => {
  let finish!: (value: { localPath: string }) => void
  let notify!: (event: FileActivity) => void
  const openRemote = vi.fn(
    () =>
      new Promise<{ localPath: string }>((resolve) => {
        finish = resolve
      }),
  )
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: string }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries:
            side === 'local'
              ? []
              : [{ name: 'large.txt', type: 'file', size: 1000, modifiedAt: 2, isSymlink: false }],
        }),
        onActivity: (listener: typeof notify) => {
          notify = listener
          return () => {}
        },
        openRemote,
      },
    },
  })
  const view = render(<SftpBrowser mode="remote-only" sessionId="session-id" />)
  const file = await screen.findByText('large.txt')
  fireEvent.doubleClick(file)
  expect(screen.getByRole('progressbar', { name: /large.txt/ }).getAttribute('value')).toBeNull()
  fireEvent.doubleClick(file)
  expect(openRemote).toHaveBeenCalledTimes(1)
  act(() =>
    notify({
      sessionId: 'session-id',
      path: '/home/tester/large.txt',
      kind: 'open',
      state: 'running',
      completed: 500,
      total: 1000,
    }),
  )
  expect(screen.getByRole('progressbar', { name: /large.txt/ }).getAttribute('value')).toBe('500')
  expect(screen.getByText('Загрузка… 50%')).toBeTruthy()
  act(() =>
    notify({
      sessionId: 'other-session',
      path: '/home/tester/large.txt',
      kind: 'open',
      state: 'done',
      completed: 1000,
    }),
  )
  expect(screen.getByRole('progressbar', { name: /large.txt/ })).toBeTruthy()
  await act(async () => {
    finish({ localPath: 'C:\\Temp\\large.txt' })
  })
  expect(screen.queryByRole('progressbar')).toBeNull()
  act(() =>
    notify({
      sessionId: 'session-id',
      path: '/home/tester/large.txt',
      kind: 'download',
      state: 'running',
      completed: 250,
      total: 1000,
    }),
  )
  expect(screen.getByText('Перенос… 25%')).toBeTruthy()
  view.rerender(<SftpBrowser mode="remote-only" sessionId="session-two" />)
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('opens a remote file without showing a success banner', async () => {
  const openRemote = vi.fn(async () => ({ localPath: 'C:\\Temp\\remote.txt' }))
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries:
            side === 'local'
              ? []
              : [
                  {
                    name: 'remote.txt',
                    type: 'file' as const,
                    size: 2,
                    modifiedAt: 2,
                    isSymlink: false,
                  },
                ],
        }),
        openRemote,
      },
    },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)

  fireEvent.doubleClick(await screen.findByText('remote.txt'))

  await waitFor(() =>
    expect(openRemote).toHaveBeenCalledWith('session-id', '/home/tester/remote.txt'),
  )
  expect(screen.queryByText(/Файл открыт в приложении/)).toBeNull()
})

it('remoteOnlyShowsTheRemoteBrowserAndDownloadsSelectedFiles', async () => {
  const enqueue = vi.fn(async () => 'download-id'),
    local = { name: 'local.txt', type: 'file' as const, size: 1, modifiedAt: 1, isSymlink: false },
    remote = { name: 'remote.txt', type: 'file' as const, size: 2, modifiedAt: 2, isSymlink: false }
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        chooseUpload: async () => ['C:\\Upload\\firmware.bin'],
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries: side === 'local' ? [local] : [remote],
        }),
        enqueue,
      },
    },
  })
  render(
    <SftpBrowser
      mode="remote-only"
      sessionId="session-id"
      onTransfer={(direction, sourceDir, targetDir, files) => {
        for (const entry of files)
          void enqueue({
            sessionId: 'session-id',
            direction,
            source: sourceDir + '/' + entry.name,
            target: targetDir + '\\' + entry.name,
            overwrite: false,
          })
      }}
    />,
  )
  expect(await screen.findByText('remote.txt')).toBeTruthy()
  expect(screen.queryByText('Этот компьютер')).toBeNull()
  fireEvent.click(screen.getByText('remote.txt'))
  fireEvent.click(screen.getByRole('button', { name: 'Скачать' }))
  await waitFor(() =>
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'download',
        source: '/home/tester/remote.txt',
        target: 'C:\\Users\\tester\\remote.txt',
      }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить файлы…' }))
  await waitFor(() =>
    expect(enqueue).toHaveBeenCalledWith({
      sessionId: 'session-id',
      direction: 'upload',
      source: 'C:\\Upload\\firmware.bin',
      target: '/home/tester/firmware.bin',
      overwrite: false,
    }),
  )
})

it('edits owner group and three permission classes and submits chown plus chmod', async () => {
  const remote = {
      name: 'remote.txt',
      type: 'file' as const,
      size: 2,
      modifiedAt: 2,
      isSymlink: false,
      permissions: 0o644,
      owner: 'alice',
      group: 'network',
    },
    mutate = vi.fn(async () => {})
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries: side === 'local' ? [] : [remote],
          capabilities: {
            list: true,
            upload: true,
            download: true,
            mkdir: true,
            rename: true,
            remove: true,
            chmod: true,
            chown: true,
            dragOut: true,
          },
        }),
        mutate,
      },
    },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)

  fireEvent.click(await screen.findByText('remote.txt'))
  fireEvent.click(screen.getByRole('button', { name: 'Изменить права доступа' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Владелец' }), {
    target: { value: 'bob' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Группа' }), {
    target: { value: 'sysadmin' },
  })
  expect(screen.queryByRole('textbox', { name: 'Права доступа (rwx)' })).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Владелец: Чтение' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'Группа: Запись' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'Остальные: Выполнение' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Группа: Запись' }))
  expect(
    (screen.getByRole('textbox', { name: 'Права доступа (octal)' }) as HTMLInputElement).value,
  ).toBe('0664')
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith({
      side: 'remote',
      sessionId: 'session-id',
      operation: 'chown',
      path: '/home/tester/remote.txt',
      owner: 'bob',
      group: 'sysadmin',
    }),
  )
  expect(mutate).toHaveBeenCalledWith({
    side: 'remote',
    sessionId: 'session-id',
    operation: 'chmod',
    path: '/home/tester/remote.txt',
    permissions: 0o664,
  })
})

it('restores special permission bits after changing owner or group', async () => {
  const remote = {
      name: 'service',
      type: 'file' as const,
      size: 2,
      modifiedAt: 2,
      isSymlink: false,
      permissions: 0o4755,
      owner: 'root',
      group: 'root',
    },
    mutate = vi.fn(async () => {})
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries: side === 'local' ? [] : [remote],
          capabilities: {
            list: true,
            upload: true,
            download: true,
            mkdir: true,
            rename: true,
            remove: true,
            chmod: true,
            chown: true,
            dragOut: true,
          },
        }),
        mutate,
      },
    },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)

  fireEvent.click(await screen.findByText('service'))
  fireEvent.click(screen.getByRole('button', { name: 'Изменить права доступа' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Владелец' }), {
    target: { value: 'service' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2))
  expect(mutate.mock.calls.map(([request]) => request)).toEqual([
    {
      side: 'remote',
      sessionId: 'session-id',
      operation: 'chown',
      path: '/home/tester/service',
      owner: 'service',
      group: 'root',
    },
    {
      side: 'remote',
      sessionId: 'session-id',
      operation: 'chmod',
      path: '/home/tester/service',
      permissions: 0o4755,
    },
  ])
})

it('accepts local file drops on the remote browser and enqueues uploads', async () => {
  const enqueueDropped = vi.fn(async () => ['upload-id'])
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/home/tester',
          entries: [],
        }),
        getPathForFile: () => 'C:\\Upload\\firmware.bin',
        enqueueDropped,
      },
    },
  })
  render(<SftpBrowser mode="remote-only" sessionId="session-id" />)

  const remotePane = (await screen.findByText('Удалённый сервер')).closest('section')!
  fireEvent.dragOver(remotePane, { dataTransfer: { types: ['Files'], dropEffect: 'none' } })
  fireEvent.drop(remotePane, {
    dataTransfer: { files: [new File(['firmware'], 'firmware.bin')], types: ['Files'] },
  })

  await waitFor(() =>
    expect(enqueueDropped).toHaveBeenCalledWith(
      ['C:\\Upload\\firmware.bin'],
      'session-id',
      '/home/tester',
    ),
  )
})

it('dismisses an open permissions dialog when switching SSH sessions', async () => {
  const remote = {
      name: 'remote.txt',
      type: 'file' as const,
      size: 2,
      modifiedAt: 2,
      isSymlink: false,
      permissions: 0o644,
    },
    mutate = vi.fn(async () => {})
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side, sessionId }: { side: 'local' | 'remote'; sessionId?: string }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : `/${sessionId}`,
          entries: side === 'local' ? [] : [remote],
        }),
        mutate,
      },
    },
  })
  const view = render(<SftpBrowser mode="remote-only" sessionId="session-one" />)
  fireEvent.click(await screen.findByText('remote.txt'))
  fireEvent.click(screen.getByRole('button', { name: 'Изменить права доступа' }))
  expect(screen.getByRole('dialog')).toBeTruthy()

  view.rerender(<SftpBrowser mode="remote-only" sessionId="session-two" />)

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(mutate).not.toHaveBeenCalled()
})

it('uses the WSL distribution file root and enables its supported file actions', async () => {
  const root = '\\\\wsl.localhost\\Ubuntu\\home\\tester',
    list = vi.fn(async ({ side }: { side: 'local' | 'remote' }) =>
      side === 'local'
        ? {
            path: 'C:\\Users\\tester',
            entries: [],
            mode: 'local' as const,
            capabilities: {
              list: true,
              upload: false,
              download: false,
              mkdir: true,
              rename: true,
              remove: true,
              chmod: false,
              dragOut: false,
            },
          }
        : {
            path: root,
            entries: [
              {
                name: 'wsl.txt',
                type: 'file' as const,
                size: 1,
                modifiedAt: 1,
                isSymlink: false,
                permissions: 0o644,
              },
            ],
            mode: 'wsl' as const,
            capabilities: {
              list: true,
              upload: true,
              download: true,
              mkdir: true,
              rename: true,
              remove: true,
              chmod: true,
              dragOut: false,
            },
          },
    )
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { files: { localRoot: async () => 'C:\\Users\\tester', list } },
  })
  render(<SftpBrowser mode="remote-only" sessionId="wsl-session" />)
  expect(await screen.findByText('wsl.txt')).toBeTruthy()
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith({ side: 'remote', path: '.', sessionId: 'wsl-session' }),
  )
  fireEvent.click(await screen.findByText('wsl.txt'))
  expect(
    screen.getByRole('button', { name: 'Изменить права доступа' }).hasAttribute('disabled'),
  ).toBe(false)
})

it('explains that Telnet has no file transfer channel', () => {
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { files: { localRoot: async () => 'C:\\Users\\tester' } },
  })
  render(
    <SftpBrowser
      mode="remote-only"
      unsupportedReason="Telnet не поддерживает обмен файлами: у протокола нет файлового канала."
    />,
  )
  expect(screen.getByText(/Telnet не поддерживает обмен файлами/)).toBeTruthy()
})

it('hidesAndRestoresQueueAndOpensCompletedDownloads', async () => {
  const completed: TransferSnapshot = {
    id: 'download-id',
    sessionId: 'session-id',
    direction: 'download',
    source: '/remote/report.txt',
    target: 'C:\\Downloads\\report.txt',
    state: 'completed',
    bytesDone: 12,
    bytesTotal: 12,
  }
  const active: TransferSnapshot = {
    id: 'active-id',
    sessionId: 'session-id',
    direction: 'upload',
    source: 'C:\\Upload\\active.bin',
    target: '/remote/active.bin',
    state: 'running',
    bytesDone: 4,
    bytesTotal: 12,
  }
  const openLocal = vi.fn(async () => {}),
    clearCompleted = vi.fn(async () => {})
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        transfers: async () => [completed, active],
        onTransfer: () => () => {},
        openLocal,
        clearCompleted,
      },
    },
  })
  render(<Transfers sessionId="session-id" />)
  expect(await screen.findByText(/report.txt/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Открыть файл' }))
  await waitFor(() => expect(openLocal).toHaveBeenCalledWith(completed.target))
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть очередь передач' }))
  expect(screen.queryByText(/report.txt/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Показать очередь передач/ }))
  expect(await screen.findByText(/report.txt/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Очистить завершённые' }))
  await waitFor(() => expect(clearCompleted).toHaveBeenCalledWith('session-id'))
  expect(screen.queryByText(/report.txt/)).toBeNull()
  expect(screen.getByText(/active.bin/)).toBeTruthy()
})

it('moves an internal remote drag into the target folder without starting native OLE', async () => {
  const move = vi.fn(async () => {}),
    beginExternalDrag = vi.fn(async () => true)
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        move,
        beginExternalDrag,
        list: async () => ({
          path: '/srv',
          mode: 'sftp',
          capabilities: { rename: true, dragOut: true },
          entries: [
            { name: 'source', type: 'file', size: 1, modifiedAt: 1, isSymlink: false },
            { name: 'target', type: 'directory', size: 0, modifiedAt: 1, isSymlink: false },
          ],
        }),
      },
    },
  })
  render(<SftpBrowser sessionId="session-owner" />)
  const source = (await screen.findByText('source')).closest('tr')!
  const target = screen.getByText('target').closest('tr')!
  const payload: Record<string, string> = {}
  const dataTransfer = {
    types: ['application/x-termlume-file'],
    effectAllowed: '',
    setData: (type: string, data: string) => {
      payload[type] = data
    },
    getData: (type: string) => payload[type],
  }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  await waitFor(() =>
    expect(move).toHaveBeenCalledWith({
      side: 'remote',
      sessionId: 'session-owner',
      path: '/srv/source',
      destination: '/srv/target',
    }),
  )
  expect(beginExternalDrag).not.toHaveBeenCalled()
})
