import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('update indicator offers once per version and does not pass shortcuts behind the dialog', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-update-dialog-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: /локальная консоль, избранное и подключение/i }).click()
    await page.getByRole('menuitem', { name: /^PowerShell/ }).click()
    await expect(page.locator('.session-tab')).toHaveCount(1)
    const offer = { state: 'available' as const, channel: 'prerelease' as const, currentVersion: '0.1.0-alpha.3', version: '0.1.0-alpha.99', releaseNotes: '<h3>Исправлено</h3><ul><li>Перенос файлов внутри сервера</li></ul>' }
    const emit = (status: typeof offer) => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('terminal:update-status', value), status)
    await emit(offer)
    const dialog = page.getByRole('dialog', { name: 'Доступно обновление Termlume' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Перенос файлов внутри сервера')
    await page.keyboard.press('Control+w')
    await expect(page.locator('.session-tab')).toHaveCount(1)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Возможно позже' }).click()
    await expect.poll(async () => page.evaluate(async () => (await window.terminalApi.settings.get()).dismissedUpdateVersion)).toBe(offer.version)
    await emit(offer)
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Обновления Termlume', exact: true }).click()
    await expect(dialog).toBeVisible()
    if (process.env.TERMLUME_PREVIEW_DIR) await page.screenshot({ path: join(process.env.TERMLUME_PREVIEW_DIR, 'update-dialog.png') })
    await dialog.getByRole('button', { name: 'Возможно позже' }).click()
    await page.reload()
    await emit(offer)
    await expect(dialog).toHaveCount(0)
    await emit({ ...offer, version: '0.1.0-alpha.100' })
    await expect(dialog).toBeVisible()
  } finally {
    await allowClosing(app); await app.close()
    await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
