import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

test('launchesIsolatedWindow', async () => {
  expect(existsSync('out/main/index.js'), 'Application entry must be built').toBe(true)
  const data = await mkdtemp(join(tmpdir(), 'terminal-e2e-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', `--user-data-dir=${data}`], env })
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('Termlume')
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
    await expect(
      page.getByRole('button', { name: 'Новое подключение', exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Горячие клавиши' }).click()
    const shortcuts = page.getByRole('dialog', { name: 'Горячие клавиши' })
    await expect(shortcuts).toContainText('Ctrl+W')
    await expect(shortcuts).toContainText('Ctrl+Alt+4')
    await page.keyboard.press('Escape')
    await expect(shortcuts).toBeHidden()
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
