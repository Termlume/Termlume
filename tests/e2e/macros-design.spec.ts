import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('macro settings persist, slash inserts without executing, and backup fields align in both themes', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-macros-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async () => {
      for (const [name, host, tags] of [
        ['Development', '192.0.2.10', ['dev']],
        ['Production', '192.0.2.20', ['prod']],
      ] as const) {
        await window.terminalApi.hosts.save({
          id: crypto.randomUUID(),
          name,
          protocol: 'ssh',
          host,
          port: 22,
          username: 'demo',
          auth: 'password',
          tags: [...tags],
          group: 'Demo',
          favorite: false,
          monitoringEnabled: true,
        })
      }
    })
    await page.reload()
    await expect(page.locator('.avatar')).toHaveCount(0)
    await expect(page.locator('.sidebar-heading')).not.toContainText('ЛИЧНОЕ ПРОСТРАНСТВО')
    await expect(page.locator('.sidebar-bottom .version')).toHaveText('0.2.2')
    expect((await page.evaluate(() => window.terminalApi.settings.get())).updateChannel).toBe(
      'stable',
    )
    await page.screenshot({ path: 'test-results/hosts-dark.png' })
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('tab', { name: 'Макросы', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить макрос', exact: true }).click()
    await page.getByLabel('Имя макроса 1', { exact: true }).fill('answer')
    await page.getByLabel('Описание макроса 1', { exact: true }).fill('Проверка макроса')
    await page.getByLabel('Команда макроса 1', { exact: true }).fill('Write-Output (424240 + 2)')
    const checkFields = async () => {
      await page.getByRole('tab', { name: 'Резервные копии', exact: true }).click()
      await page.locator('.data-transfer').scrollIntoViewIfNeeded()
      const boxes = await page.locator('.data-transfer input[type=password]').evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect()
          return { top: r.top, width: r.width, right: r.right }
        }),
      )
      expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThan(1)
      expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(1)
      const modal = await page.locator('.appearance-modal').boundingBox()
      expect(boxes[1].right).toBeLessThan(modal!.x + modal!.width)
    }
    await checkFields()
    await page.getByRole('tab', { name: 'Внешний вид', exact: true }).click()
    await page.getByRole('button', { name: 'VS Code Light Modern', exact: true }).click()
    await checkFields()
    await page.screenshot({ path: 'test-results/macros-settings-light.png' })
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/hosts-light.png' })
    await page.reload()
    expect((await page.evaluate(() => window.terminalApi.settings.get())).macros?.[0].name).toBe(
      'answer',
    )
    await page.getByRole('button', { name: /локальная консоль, избранное и подключение/i }).click()
    await page.getByRole('menuitem', { name: /^PowerShell/ }).click()
    const rows = page.locator('.terminal-pane.active .xterm-rows')
    await expect(rows).toContainText('PS ')
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea')
    await input.focus()
    await page.keyboard.type('/ans')
    const list = page.getByRole('listbox', { name: 'Доступные макросы' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('option')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/macro-popup.png' })
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(rows).toContainText('Write-Output (424240 + 2)')
    await expect(rows).not.toContainText('424242')
    await page.keyboard.press('Enter')
    await expect(rows).toContainText('424242')
    await page.keyboard.type('/usr')
    await expect(page.locator('.terminal-macros')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(rows).toContainText('/usr')
    await expect(page.locator('.terminal-macros')).toHaveCount(0)
    await page.keyboard.press('Control+c')
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('tab', { name: 'Макросы', exact: true }).click()
    await expect(page.getByLabel('Имя макроса 1', { exact: true })).toHaveValue('answer')
    await page.getByRole('button', { name: 'Удалить макрос 1', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await page.evaluate(() => window.terminalApi.settings.get())).macros).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
