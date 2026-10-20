// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SplitWorkspace } from '../../src/renderer/src/features/workspace/SplitWorkspace'

afterEach(cleanup)
const mounted = vi.fn()
function Probe({ id }: { id: string }) {
  useEffect(() => {
    mounted(id)
    return () => mounted('unmounted:' + id)
  }, [id])
  return createElement('div', { 'data-testid': `terminal-${id}` })
}

it('keeps every session mounted once while adding from the tab picker and removing panes', async () => {
  const onFocus = vi.fn()
  mounted.mockClear()
  render(
    createElement(SplitWorkspace, {
      sessionIds: ['one', 'two'],
      activeId: 'one',
      onFocus,
      renderSession: (id) => createElement(Probe, { id }),
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Добавить терминал' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'two · SSH' }))
  await waitFor(() => expect(screen.getAllByRole('separator')).toHaveLength(1))
  expect(mounted.mock.calls.filter(([id]) => !String(id).startsWith('unmounted:'))).toEqual([
    ['one'],
    ['two'],
  ])
  expect(screen.getAllByTestId('terminal-one')).toHaveLength(1)
  expect(screen.getAllByTestId('terminal-two')).toHaveLength(1)
  expect(screen.getAllByRole('separator')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Убрать панель two' }))
  await waitFor(() => expect(screen.queryAllByRole('separator')).toHaveLength(0))
  expect(screen.getAllByTestId('terminal-one')).toHaveLength(1)
  expect(screen.getAllByTestId('terminal-two')).toHaveLength(1)
})
