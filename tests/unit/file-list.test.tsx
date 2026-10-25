// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FileList } from '../../src/renderer/src/features/sftp/FileList'

afterEach(cleanup)

it('opens context actions by right click and keyboard, preserving multiple selection', () => {
  const entry = {
    name: 'config',
    type: 'file' as const,
    size: 1,
    modifiedAt: 1,
    isSymlink: false,
    owner: 'root',
    group: 'admin',
  }
  const onSelect = vi.fn(),
    onContextMenu = vi.fn()
  render(
    <FileList
      entries={[entry]}
      selected={['config', 'other']}
      onSelect={onSelect}
      onOpen={() => {}}
      onParent={() => {}}
      onContextMenu={onContextMenu}
    />,
  )
  const row = screen.getByText('config').closest('tr')!
  fireEvent.contextMenu(row, { clientX: 12, clientY: 24 })
  expect(onSelect).not.toHaveBeenCalled()
  expect(onContextMenu).toHaveBeenCalledWith(entry, 12, 24)
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
  expect(onContextMenu).toHaveBeenCalledTimes(2)
  expect(screen.getByText('root')).toBeTruthy()
  expect(screen.getByText('admin')).toBeTruthy()
})

it('sorts by numeric columns in both directions while keeping folders first and resizes by keyboard', () => {
  const entries = [
    { name: 'large', type: 'file' as const, size: 500, modifiedAt: 2, isSymlink: false },
    { name: 'small', type: 'file' as const, size: 2, modifiedAt: 1, isSymlink: false },
    { name: 'folder', type: 'directory' as const, size: 0, modifiedAt: 3, isSymlink: false },
  ]
  const view = render(
    <FileList
      entries={entries}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
    />,
  )
  const names = () =>
    [...view.container.querySelectorAll('tr[data-name]')].map((row) =>
      row.getAttribute('data-name'),
    )
  fireEvent.click(screen.getByRole('button', { name: 'Размер' }))
  expect(names()).toEqual(['folder', 'small', 'large'])
  fireEvent.click(screen.getByRole('button', { name: /Размер/ }))
  expect(names()).toEqual(['folder', 'large', 'small'])
  const handle = screen.getByRole('separator', { name: 'Ширина: Имя' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(handle.getAttribute('aria-valuenow')).toBe('190')
  const columns = [...view.container.querySelectorAll('col')]
  expect(columns[0].style.width).toContain('%')
  expect(columns.reduce((sum, column) => sum + parseFloat(column.style.width), 0)).toBeCloseTo(100)
  expect(view.container.querySelector('table')?.style.minWidth).toBe('')
})

it('keeps in-window drags in Chromium and starts native drag only outside the window', () => {
  const entry = {
      name: 'router.conf',
      type: 'file' as const,
      size: 12,
      modifiedAt: 1,
      isSymlink: false,
    },
    beginExternalDrag = vi.fn(() => true)
  render(
    <FileList
      entries={[entry]}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
      dragOwner="test-owner"
      onBeginExternalDrag={beginExternalDrag}
    />,
  )

  const row = screen.getByText('router.conf').closest('tr')!
  const started = fireEvent.dragStart(row, {
    dataTransfer: { effectAllowed: '', setData: vi.fn() },
  })

  expect(beginExternalDrag).not.toHaveBeenCalled()
  expect(started).toBe(true)
  fireEvent(
    document,
    new MouseEvent('dragleave', { clientX: 25, clientY: 25, relatedTarget: null }),
  )
  expect(beginExternalDrag).not.toHaveBeenCalled()
  fireEvent(
    document,
    new MouseEvent('dragleave', { clientX: -1, clientY: 25, relatedTarget: null }),
  )
  expect(beginExternalDrag).toHaveBeenCalledWith(entry)
  fireEvent(
    document,
    new MouseEvent('dragleave', { clientX: -1, clientY: 25, relatedTarget: null }),
  )
  expect(beginExternalDrag).toHaveBeenCalledTimes(1)
})

it('shows remote permissions as octal and symbolic access modes', () => {
  render(
    <FileList
      entries={[
        {
          name: 'router.conf',
          type: 'file',
          size: 12,
          modifiedAt: 1,
          isSymlink: false,
          permissions: 0o754,
        },
      ]}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
    />,
  )

  expect(screen.getByText('0754 · rwxr-xr--')).toBeTruthy()
})

it('moves an internal file into a folder only for its owning browser', () => {
  const move = vi.fn(),
    native = vi.fn()
  render(
    <FileList
      entries={[
        { name: 'source', type: 'file', size: 1, modifiedAt: 1, isSymlink: false },
        { name: 'target', type: 'directory', size: 0, modifiedAt: 1, isSymlink: false },
      ]}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
      dragOwner="owner"
      onMove={move}
      onBeginExternalDrag={native}
    />,
  )
  const payload: Record<string, string> = {}
  const dataTransfer = {
    effectAllowed: '',
    types: ['application/x-termlume-file'],
    setData: (type: string, data: string) => {
      payload[type] = data
    },
    getData: (type: string) => payload[type],
  }
  fireEvent.dragStart(screen.getByText('source').closest('tr')!, { dataTransfer })
  fireEvent.drop(screen.getByText('target').closest('tr')!, { dataTransfer })
  expect(move).toHaveBeenCalledWith('source', expect.objectContaining({ name: 'target' }))
  expect(native).not.toHaveBeenCalled()
  payload['application/x-termlume-file'] = JSON.stringify({
    owner: 'different-server',
    name: 'source',
  })
  fireEvent.drop(screen.getByText('target').closest('tr')!, { dataTransfer })
  expect(move).toHaveBeenCalledTimes(1)
})

it('starts native Linux drag only on an actual gesture and leaves hover/selection inert', async () => {
  const entry = {
    name: 'logs',
    type: 'directory' as const,
    size: 0,
    modifiedAt: 1,
    isSymlink: false,
  }
  const native = vi.fn(async () => '/tmp/export/logs')
  render(
    <FileList
      entries={[entry]}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
      dragOwner="linux-owner"
      nativeDrag
      onBeginExternalDrag={native}
    />,
  )
  const row = screen.getByText('logs').closest('tr')!
  fireEvent.mouseEnter(row)
  fireEvent.click(row)
  expect(native).not.toHaveBeenCalled()
  const allowed = fireEvent.dragStart(row, {
    dataTransfer: { effectAllowed: '', setData: vi.fn() },
  })
  expect(allowed).toBe(false)
  expect(native).toHaveBeenCalledTimes(1)
  expect(native).toHaveBeenCalledWith(entry)
})

it('resolves a native drop back to the remote source and lets unrelated files reach the upload handler', async () => {
  const source = {
      name: 'source',
      type: 'file' as const,
      size: 1,
      modifiedAt: 1,
      isSymlink: false,
    },
    target = {
      name: 'target',
      type: 'directory' as const,
      size: 0,
      modifiedAt: 1,
      isSymlink: false,
    }
  const move = vi.fn(),
    getPathForFile = vi.fn(() => '/tmp/export/source')
  Object.defineProperty(window, 'terminalApi', {
    configurable: true,
    value: { files: { getPathForFile } },
  })
  render(
    <FileList
      entries={[source, target]}
      selected={[]}
      onSelect={() => {}}
      onOpen={() => {}}
      onParent={() => {}}
      dragOwner="linux-owner"
      nativeDrag
      onBeginExternalDrag={async () => '/tmp/export/source'}
      onMove={move}
    />,
  )
  fireEvent.dragStart(screen.getByText('source').closest('tr')!, {
    dataTransfer: { effectAllowed: '', setData: vi.fn() },
  })
  await waitFor(() => expect(getPathForFile).not.toHaveBeenCalled())
  const payload = {
    types: ['Files'],
    dropEffect: 'none',
    files: [new File(['a'], 'source')],
    getData: () => '',
  }
  fireEvent.dragOver(screen.getByText('target').closest('tr')!, { dataTransfer: payload })
  expect(payload.dropEffect).toBe('copy')
  fireEvent.drop(screen.getByText('target').closest('tr')!, { dataTransfer: payload })
  expect(move).toHaveBeenCalledWith('source', expect.objectContaining({ name: 'target' }))
  fireEvent.dragStart(screen.getByText('source').closest('tr')!, {
    dataTransfer: { effectAllowed: '', setData: vi.fn() },
  })
  await Promise.resolve()
  await Promise.resolve()
  getPathForFile.mockReturnValue('/home/user/unrelated.txt')
  expect(fireEvent.drop(screen.getByText('target').closest('tr')!, { dataTransfer: payload })).toBe(
    true,
  )
  expect(move).toHaveBeenCalledTimes(1)
})
