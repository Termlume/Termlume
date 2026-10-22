import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('file browser follows real PowerShell cd and stops when disabled', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-directory-'))
  const target = join(data, 'folder with spaces')
  await mkdir(target)
  const canonicalTarget = await realpath(target)
  const canonicalData = await realpath(data)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: /локальная консоль, избранное и подключение/i }).click()
    await page.getByRole('menuitem', { name: /^PowerShell/ }).click()
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea')
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('PS ')
    await input.focus()
    await page.keyboard.insertText(`Set-Location -LiteralPath '${target}'`)
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    await expect(page.getByLabel('Удалённый путь', { exact: true })).toHaveValue(canonicalTarget)
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('tab', { name: 'Файлы', exact: true }).click()
    const followDirectory = page.getByLabel('Следовать за папкой терминала', { exact: true })
    await followDirectory.click()
    await expect(followDirectory).not.toBeChecked()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await input.focus()
    await page.keyboard.insertText(`Set-Location -LiteralPath '${data}'`)
    await page.keyboard.press('Enter')
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      `PS ${canonicalData}>`,
    )
    await expect(page.getByLabel('Удалённый путь', { exact: true })).toHaveValue(canonicalTarget)
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
