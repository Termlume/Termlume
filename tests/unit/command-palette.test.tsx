// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  CommandPalette,
  type CommandAction,
} from '../../src/renderer/src/features/commands/CommandPalette'
afterEach(cleanup)
const fixture = (): CommandAction[] => [
  { id: 'local', label: 'Новый терминал', shortcut: 'Ctrl+T', run: vi.fn() },
  { id: 'host', label: 'Production', detail: 'SSH · admin@10.0.0.1', run: vi.fn() },
  { id: 'settings', label: 'Настройки', run: vi.fn() },
]
it('focuses search and finds commands using label and connection details', () => {
  render(<CommandPalette actions={fixture()} onClose={() => {}} />)
  const input = screen.getByRole('combobox')
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'PROD admin' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option').textContent).toContain('Production')
})
it('navigates with wraparound, closes before executing and stops keyboard propagation', () => {
  const order: string[] = [],
    outer = vi.fn()
  const actions = fixture()
  actions[2].run = () => {
    order.push('run')
  }
  render(
    <div onKeyDown={outer}>
      <CommandPalette
        actions={actions}
        onClose={() => {
          order.push('close')
        }}
      />
    </div>,
  )
  const input = screen.getByRole('combobox')
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(order).toEqual(['close', 'run'])
  expect(outer).not.toHaveBeenCalled()
})
it('resets selection on search, safely handles empty results and Escape', () => {
  const actions = fixture(),
    close = vi.fn()
  render(<CommandPalette actions={actions} onClose={close} />)
  const input = screen.getByRole('combobox')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.change(input, { target: { value: 'терминал' } })
  expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('true')
  fireEvent.change(input, { target: { value: 'missing' } })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toBeDefined()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})
it('executes a clicked option and keeps tab focus inside the dialog', () => {
  const actions = fixture(),
    close = vi.fn()
  render(<CommandPalette actions={actions} onClose={close} />)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('combobox'))
  fireEvent.click(screen.getAllByRole('option')[1])
  expect(close).toHaveBeenCalledOnce()
  expect(actions[1].run).toHaveBeenCalledOnce()
})
