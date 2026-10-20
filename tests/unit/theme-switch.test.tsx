// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { ThemeController } from '../../src/renderer/src/themes/apply-theme'
it('previewAndCancelRestoreSavedTheme', async () => {
  const updates: string[] = []
  window.addEventListener('terminal-theme-change', (event) => {
    updates.push((event as CustomEvent<string>).detail)
  })
  let saved = 'catppuccin-mocha'
  const controller = new ThemeController('catppuccin-mocha', async (id) => {
    saved = id
  })
  controller.preview('catppuccin-latte')
  expect(document.documentElement.dataset.theme).toBe('catppuccin-latte')
  expect(saved).toBe('catppuccin-mocha')
  controller.cancel()
  expect(document.documentElement.dataset.theme).toBe('catppuccin-mocha')
  expect(updates).toEqual(['catppuccin-latte', 'catppuccin-mocha'])
})
it('applyCommitsOnlyThePreviewedTheme', async () => {
  let saved = 'catppuccin-mocha'
  const controller = new ThemeController('catppuccin-mocha', async (id) => {
    saved = id
  })
  controller.preview('tokyo-night')
  await controller.apply()
  controller.preview('one-dark')
  controller.cancel()
  expect(saved).toBe('tokyo-night')
  expect(document.documentElement.dataset.theme).toBe('tokyo-night')
})
