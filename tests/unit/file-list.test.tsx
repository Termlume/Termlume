// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  expect(view.container.querySelector('col')?.style.width).toBe('190px')
})

it('starts immediate native file drags without letting Chromium own the drag', () => {
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
      onBeginExternalDrag={beginExternalDrag}
    />,
  )

  const row = screen.getByText('router.conf').closest('tr')!
  const started = fireEvent.dragStart(row, {
    dataTransfer: { effectAllowed: '', setData: vi.fn() },
  })

  expect(beginExternalDrag).toHaveBeenCalledWith(entry)
  expect(started).toBe(false)
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
