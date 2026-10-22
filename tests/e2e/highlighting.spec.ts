import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('highlight preview runs in worker, times out unsafe regex and preserves live terminal output', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-highlight-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('tab', { name: 'Подсветка', exact: true }).click()
    const preview = page.getByLabel('Предпросмотр подсветки')
    await expect(preview).toContainText('ERROR: connection FAILED')
    await expect(preview.locator('span').filter({ hasText: /^ERROR$/ })).toHaveCSS(
      'color',
      'rgb(239, 100, 97)',
    )
    const first = page.locator('.highlight-rule-detail')
    await first.getByText('Расширенные настройки', { exact: true }).click()
    await first
      .getByRole('button', { name: 'Редактировать регулярное выражение', exact: true })
      .click()
    await first.getByLabel('Регулярное выражение', { exact: true }).fill('(a+)+$')
    await page.getByLabel('Текст для проверки').fill('a'.repeat(200) + '!')
    await expect(preview).toHaveText('a'.repeat(200) + '!')
    await first.getByLabel('Регулярное выражение', { exact: true }).fill('\\b(?:ERROR|FAILED)\\b')
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: /локальная консоль, избранное и подключение/i }).click()
    await page.getByRole('menuitem', { name: /^PowerShell/ }).click()
    const rows = page.locator('.terminal-pane.active .xterm-rows')
    await expect(rows).toContainText('PS ')
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus()
    await page.keyboard.type("Write-Output 'ERROR highlight works'")
    await page.keyboard.press('Enter')
    await expect(rows).toContainText('ERROR highlight works')
    await expect(
      rows
        .locator('span')
        .filter({ hasText: /^ERROR$/ })
        .last(),
    ).toHaveCSS('color', 'rgb(239, 100, 97)')
    expect(errors).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
