import { expect, it, vi } from 'vitest'
import {
  routeShortcut,
  SHORTCUT_BINDINGS,
  type ShortcutContext,
} from '../../src/renderer/src/app/keyboard-shortcuts'
import { shouldRelayShortcut } from '../../src/main/keyboard-shortcut'

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  hasActiveTab: true,
  tabCount: 2,
  modalOpen: false,
  formFieldTarget: false,
  ...overrides,
})

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey'>> = {},
) {
  return {
    key: value,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent
}

it('documents and routes each agreed Windows shortcut', () => {
  expect(SHORTCUT_BINDINGS.map(({ keys }) => keys)).toEqual([
    'Ctrl+Shift+P',
    'Ctrl+W',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Ctrl+Shift+N',
    'Ctrl+Alt+T',
    'Ctrl+Alt+1',
    'Ctrl+Alt+2',
    'Ctrl+Alt+3',
    'Ctrl+Alt+4',
  ])
  expect(routeShortcut(key('w'), context())).toBe('close-active')
  expect(routeShortcut(key('Tab'), context())).toBe('next-tab')
  expect(routeShortcut(key('Tab', { shiftKey: true }), context())).toBe('previous-tab')
  expect(routeShortcut(key('N', { shiftKey: true }), context())).toBe('new-connection')
  expect(routeShortcut(key('t', { altKey: true }), context())).toBe('new-local')
  for (const [digit, preset] of [
    ['1', 'one'],
    ['2', 'two-vertical'],
    ['3', 'two-horizontal'],
    ['4', 'four'],
  ] as const)
    expect(routeShortcut(key(digit, { altKey: true }), context())).toEqual({
      type: 'set-layout',
      preset,
    })
})

it('does not steal keys from dialogs or form controls, and ignores close with no active tab', () => {
  expect(routeShortcut(key('w'), context({ modalOpen: true }))).toBeUndefined()
  expect(routeShortcut(key('w'), context({ formFieldTarget: true }))).toBeUndefined()
  expect(routeShortcut(key('w'), context({ hasActiveTab: false, tabCount: 0 }))).toBeUndefined()
  expect(routeShortcut(key('Tab'), context({ tabCount: 0 }))).toBeUndefined()
})

it('routes reserved shortcuts while the xterm helper input owns focus', () => {
  expect(routeShortcut(key('w'), context({ formFieldTarget: false }))).toBe('close-active')
})

it('ignores unrelated and extra-modifier keys', () => {
  expect(routeShortcut(key('w', { ctrlKey: false }), context())).toBeUndefined()
  expect(routeShortcut(key('w', { altKey: true }), context())).toBeUndefined()
  expect(routeShortcut(key('x'), context())).toBeUndefined()
})

it('relays Chromium-reserved Ctrl+Tab and Ctrl+W through Electron main', () => {
  expect(
    shouldRelayShortcut({ type: 'keyDown', key: 'Tab', control: true, shift: false, alt: false }),
  ).toBe(true)
  expect(
    shouldRelayShortcut({ type: 'keyDown', key: 'Tab', control: true, shift: true, alt: false }),
  ).toBe(true)
  expect(
    shouldRelayShortcut({ type: 'keyDown', key: 'W', control: true, shift: false, alt: false }),
  ).toBe(true)
  expect(
    shouldRelayShortcut({ type: 'keyDown', key: 'W', control: true, shift: true, alt: false }),
  ).toBe(false)
  expect(
    shouldRelayShortcut({ type: 'keyDown', key: 'Tab', control: true, shift: false, alt: true }),
  ).toBe(false)
})
