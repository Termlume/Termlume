// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SftpBrowser } from '../../src/renderer/src/features/sftp/Browser'

afterEach(cleanup)

it('queuesOneOrMoreExplorerFilesDroppedOntoTheRemoteDirectory', async () => {
  const enqueueDropped = vi.fn(async () => ['one', 'two']),
    fileA = new File(['a'], 'one.txt'),
    fileB = new File(['b'], 'two.txt')
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: string }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/srv/files',
          entries: [],
        }),
        getPathForFile: (file: File) => `C:\\Users\\tester\\${file.name}`,
        enqueueDropped,
      },
    },
  })
  render(createElement(SftpBrowser, { sessionId: 'session-id' }))
  const remote = await screen.findByText('Удалённый сервер'),
    drop = createEvent.drop(remote, {
      dataTransfer: { files: [fileA, fileB], types: ['Files'] },
    })
  fireEvent(remote, drop)
  await waitFor(() =>
    expect(enqueueDropped).toHaveBeenCalledWith(
      ['C:\\Users\\tester\\one.txt', 'C:\\Users\\tester\\two.txt'],
      'session-id',
      '/srv/files',
    ),
  )
})

it('startsNativeDragOnFirstGestureWithoutPreparation', async () => {
  const stageDrag = vi.fn(async () => ({ token: 'one-use', fileName: 'remote.txt' })),
    beginExternalDrag = vi.fn(async () => true)
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/srv/files',
          entries:
            side === 'local'
              ? []
              : [{ name: 'remote.txt', type: 'file', size: 5, modifiedAt: 1, isSymlink: false }],
          mode: side === 'local' ? 'local' : 'sftp',
          capabilities: {
            list: true,
            upload: true,
            download: true,
            mkdir: true,
            rename: true,
            remove: true,
            chmod: true,
            dragOut: side === 'remote',
          },
        }),
        stageDrag,
        beginExternalDrag,
      },
    },
  })
  render(createElement(SftpBrowser, { sessionId: 'session-id' }))
  const file = await screen.findByText('remote.txt'),
    row = file.closest('tr')!
  expect(row.getAttribute('draggable')).toBe('true')
  fireEvent.pointerEnter(row)
  fireEvent.click(file)
  expect(stageDrag).not.toHaveBeenCalled()
  expect(beginExternalDrag).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Подготовить/ })).toBeNull()
  fireEvent.dragStart(row)
  await waitFor(() =>
    expect(beginExternalDrag).toHaveBeenCalledWith({
      sessionId: 'session-id',
      path: '/srv/files/remote.txt',
      size: 5,
      modifiedAt: 1,
    }),
  )
  expect(stageDrag).not.toHaveBeenCalled()
  expect(row.getAttribute('draggable')).toBe('true')
})

it('doesNotPrepareRemoteFilesOnHoverOrOrdinarySelection', async () => {
  const stageDrag = vi.fn(async () => ({ token: 'unused', fileName: 'remote.txt' }))
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: {
      files: {
        localRoot: async () => 'C:\\Users\\tester',
        list: async ({ side }: { side: 'local' | 'remote' }) => ({
          path: side === 'local' ? 'C:\\Users\\tester' : '/srv/files',
          entries:
            side === 'remote'
              ? [{ name: 'remote.txt', type: 'file', size: 1, modifiedAt: 1, isSymlink: false }]
              : [],
          mode: side === 'remote' ? 'sftp' : 'local',
          capabilities: {
            list: true,
            upload: true,
            download: true,
            mkdir: true,
            rename: true,
            remove: true,
            chmod: true,
            dragOut: side === 'remote',
          },
        }),
        stageDrag,
      },
    },
  })
  render(createElement(SftpBrowser, { sessionId: 'session-id' }))
  const row = (await screen.findByText('remote.txt')).closest('tr')!
  fireEvent.pointerEnter(row)
  fireEvent.click(screen.getByText('remote.txt'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(stageDrag).not.toHaveBeenCalled()
})
