import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('release notes render Markdown and X11 stays compact in the host form', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-release-ui-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Обновления Termlume' }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Новые возможности', exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Исправления', exact: true })).toHaveCount(1)
    expect(await dialog.locator('.release-markdown li').count()).toBeGreaterThan(8)
    await dialog.getByRole('button', { name: 'Закрыть окно обновления' }).click()
    await page.getByRole('button', { name: 'Новое подключение', exact: true }).first().click()
    const option = page.locator('.host-x11-option')
    await expect(option.getByRole('checkbox', { name: 'Графические приложения X11' })).toBeVisible()
    expect((await option.boundingBox())!.height).toBeLessThanOrEqual(36)
    await expect(option.locator('p')).not.toBeVisible()
    await option.getByLabel('О перенаправлении X11').click()
    await expect(option.locator('p')).toBeVisible()
    const rowBox = (await option.boundingBox())!
    const helpBox = (await option.locator('p').boundingBox())!
    expect(helpBox.x).toBeGreaterThanOrEqual(rowBox.x)
    expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width)
    await page.screenshot({ path: 'test-results/compact-x11.png' })
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
