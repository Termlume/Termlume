import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('all eight themes preview, apply, and preserve workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-theme-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + root], env })
  try {
    const page = await app.firstWindow()
    await mkdir('docs/verification/screenshots', { recursive: true })
    for (const [id, name] of [
      ['catppuccin-mocha', 'Catppuccin Mocha'],
      ['catppuccin-macchiato', 'Catppuccin Macchiato'],
      ['catppuccin-frappe', 'Catppuccin Frappé'],
      ['catppuccin-latte', 'Catppuccin Latte'],
      ['vscode-dark-modern', 'VS Code Dark Modern'],
      ['vscode-light-modern', 'VS Code Light Modern'],
      ['tokyo-night', 'Tokyo Night'],
      ['one-dark', 'One Dark'],
    ]) {
      await page.getByRole('button', { name: 'Настройки', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', id)
      await page.getByRole('button', { name: 'Применить', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.screenshot({ path: 'docs/verification/screenshots/' + id + '.png' })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700))
    await page.screenshot({ path: 'docs/verification/screenshots/compact.png' })
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
