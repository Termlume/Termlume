import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('settings use bounded sections, stable metric rows and a plain language highlight builder', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-settings-layout-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.evaluate(async () => {
      const identity = await window.terminalApi.identities.save({
        id: crypto.randomUUID(),
        name: 'Example Company',
        username: 'demo',
        method: 'password',
      })
      await window.terminalApi.identities.save({
        id: crypto.randomUUID(),
        name: 'Personal servers',
        username: 'operator',
        method: 'key',
        keyPath: 'C:\\Demo\\id_ed25519',
      })
      await window.terminalApi.hosts.save({
        id: crypto.randomUUID(),
        name: 'Production API',
        protocol: 'ssh',
        host: '192.0.2.10',
        port: 22,
        username: 'demo',
        auth: 'password',
        identityId: identity.id,
        group: 'Demo',
        favorite: false,
      })
    })
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true })
    const bounds = await dialog.boundingBox()
    await expect(page.getByRole('tab')).toHaveCount(9)
    await page.getByRole('tab', { name: 'Мониторинг', exact: true }).click()
    const arrow = page.getByRole('button', { name: 'Опустить: Сервер', exact: true })
    const before = await arrow.boundingBox()
    await arrow.focus()
    await page.keyboard.press('Enter')
    await expect(arrow).toBeFocused()
    const after = await arrow.boundingBox()
    expect(Math.abs(before!.x - after!.x)).toBeLessThan(1)
    expect(after!.y).toBeGreaterThan(before!.y)
    const rows = await page
      .locator('.settings-page-monitoring .monitor-item-setting')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, width: r.width }
        }),
      )
    expect(
      rows.every(
        (row) => Math.abs(row.x - rows[0].x) < 1 && Math.abs(row.width - rows[0].width) < 1,
      ),
    ).toBe(true)
    await page.screenshot({ path: 'test-results/settings-monitoring-dark.png' })
    await page.getByRole('tab', { name: 'Подсветка', exact: true }).click()
    await expect(page.getByLabel('Слова и фразы', { exact: true })).toHaveValue('ERROR\nFAILED')
    await page.getByLabel('Слова и фразы', { exact: true }).fill('ERROR\nFAILED\nОшибка')
    await page.getByRole('combobox', { name: 'Условие', exact: true }).selectOption('contains')
    await page.getByLabel('Текст для проверки').fill('Ошибка: служба не отвечает')
    await expect(
      page
        .getByLabel('Предпросмотр подсветки')
        .locator('span')
        .filter({ hasText: /^Ошибка$/ }),
    ).toHaveCSS('color', 'rgb(239, 100, 97)')
    await page.screenshot({ path: 'test-results/settings-highlighting-dark.png' })
    await page.getByRole('tab', { name: 'Внешний вид', exact: true }).click()
    await page.getByRole('button', { name: 'VS Code Light Modern', exact: true }).click()
    await page.getByRole('tab', { name: 'Учётные данные', exact: true }).click()
    await expect(page.locator('.credentials-detail')).toContainText('Production API')
    await expect(
      page.getByRole('button', { name: 'Заменить у серверов…', exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: 'test-results/settings-credentials-light.png' })
    for (const name of ['Терминал', 'Файлы', 'Макросы', 'Резервные копии', 'Обновления']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      const sizes = await page
        .locator('.settings-content')
        .evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }))
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1)
    }
    expect(await dialog.boundingBox()).toEqual(bounds)
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'vscode-light-modern')
    await page.getByRole('tab', { name: 'Подсветка', exact: true }).click()
    await expect(page.getByLabel('Слова и фразы', { exact: true })).toHaveValue(
      'ERROR\nFAILED\nОшибка',
    )
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
    await page.screenshot({ path: 'test-results/settings-highlighting-light-compact.png' })
    const sizes = await page
      .locator('.settings-content')
      .evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1)
    expect(errors).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
