import { expect, it } from 'vitest'
import { settingsSchema } from '../../src/shared/schemas'
import { routeShortcut } from '../../src/renderer/src/app/keyboard-shortcuts'
import { shouldRelayShortcut } from '../../src/main/keyboard-shortcut'

it('routes persisted custom chords and releases the default in terminal context', () => {
  const context = { hasActiveTab: true, tabCount: 2, modalOpen: false, formFieldTarget: false }
  const event = { key: 'q', ctrlKey: true, altKey: false, shiftKey: true } as KeyboardEvent
  expect(routeShortcut(event, context, { 'close-active': 'Ctrl+Shift+Q' })).toBe('close-active')
  expect(
    routeShortcut({ ...event, key: 'w', shiftKey: false } as KeyboardEvent, context, {
      'close-active': 'Ctrl+Shift+Q',
    }),
  ).toBeUndefined()
  expect(
    shouldRelayShortcut(
      { type: 'keyDown', key: 'Q', control: true, shift: true, alt: false },
      { 'close-active': 'Ctrl+Shift+Q' },
    ),
  ).toBe(true)
})
it('validates persisted chord conflicts, reserved terminal keys and malformed shortcuts', () => {
  expect(
    settingsSchema.safeParse({ shortcutBindings: { 'close-active': 'Ctrl+Tab' } }).success,
  ).toBe(false)
  expect(settingsSchema.safeParse({ shortcutBindings: { 'close-active': 'Ctrl+C' } }).success).toBe(
    false,
  )
  expect(settingsSchema.safeParse({ shortcutBindings: { 'close-active': 'W' } }).success).toBe(
    false,
  )
  expect(
    settingsSchema.parse({ shortcutBindings: { 'close-active': 'Ctrl+Shift+Q' } }).shortcutBindings,
  ).toEqual({ 'close-active': 'Ctrl+Shift+Q' })
})
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsRepository } from '../../src/main/storage/SettingsRepository'

it('retains custom shortcuts across repository reload and default reset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'termlume-shortcuts-'))
  try {
    const file = join(directory, 'settings.json')
    await new SettingsRepository(file).update({
      shortcutBindings: { 'close-active': 'Ctrl+Shift+Q' },
    })
    const reloaded = new SettingsRepository(file)
    expect((await reloaded.get()).shortcutBindings).toEqual({ 'close-active': 'Ctrl+Shift+Q' })
    await reloaded.update({ shortcutBindings: {} })
    expect((await new SettingsRepository(file).get()).shortcutBindings).toEqual({})
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
