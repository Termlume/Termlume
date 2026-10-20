// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SplitWorkspace } from '../../src/renderer/src/features/workspace/SplitWorkspace'

afterEach(cleanup)

it('offers searchable open tabs by connection name and protocol without duplicates', () => {
  render(
    <SplitWorkspace
      sessionIds={['router', 'linux', 'local']}
      activeId="linux"
      sessionOptions={[
        { id: 'router', name: 'Office Router', protocol: 'telnet' },
        { id: 'linux', name: 'Prod Linux', protocol: 'ssh' },
        { id: 'local', name: 'PowerShell', protocol: 'local' },
      ]}
      onFocus={() => {}}
      renderSession={(id) => <div>{id}</div>}
    />,
  )

  expect(screen.queryByText('Сеанс')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Добавить терминал' }))
  const picker = screen.getByRole('menu', { name: 'Открытые вкладки' })
  fireEvent.change(within(picker).getByRole('searchbox', { name: 'Поиск вкладок' }), {
    target: { value: 'router' },
  })
  fireEvent.click(within(picker).getByRole('menuitem', { name: /Office Router.*Telnet/i }))
  expect(document.querySelectorAll('.split-session:not([style*="display: none"])')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить терминал' }))
  expect(
    within(screen.getByRole('menu', { name: 'Открытые вкладки' })).queryByText(/Office Router/i),
  ).toBeNull()
})

it('exposes named layout presets with selected state and resizes existing panes', () => {
  const onFocus = vi.fn()
  render(
    <SplitWorkspace
      sessionIds={['one', 'two', 'three', 'four']}
      activeId="three"
      sessionOptions={[
        { id: 'one', name: 'One', protocol: 'ssh' },
        { id: 'two', name: 'Two', protocol: 'ssh' },
        { id: 'three', name: 'Three', protocol: 'wsl' },
        { id: 'four', name: 'Four', protocol: 'local' },
      ]}
      onFocus={onFocus}
      renderSession={(id) => <div>{id}</div>}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Две панели сверху и снизу' }))
  expect(
    screen.getByRole('button', { name: 'Две панели сверху и снизу' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(document.querySelectorAll('.split-session:not([style*="display: none"])')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Четыре панели' }))
  expect(document.querySelectorAll('.split-session:not([style*="display: none"])')).toHaveLength(4)
})

it('swapsPaneAssignmentsByDraggingOneHeaderOntoAnother', () => {
  render(
    <SplitWorkspace
      sessionIds={['one', 'two']}
      activeId="one"
      onFocus={() => {}}
      renderSession={(id) => <div>{id}</div>}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Две панели рядом' }))
  const first = document.querySelector('[data-split-session="one"]')!,
    second = document.querySelector('[data-split-session="two"]')!,
    source = second.querySelector('.split-session-heading')!,
    target = first.querySelector('.split-session-heading')!
  fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } })
  fireEvent.drop(target, { dataTransfer: { getData: () => 'two' } })
  expect(document.querySelector('[data-split-session="two"]')?.getAttribute('style')).toContain(
    'left: 0%',
  )
  expect(document.querySelector('[data-split-session="one"]')?.getAttribute('style')).toContain(
    'left: 50%',
  )
})
