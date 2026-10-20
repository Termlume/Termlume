import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('theme survives reopening settings and custom shortcut works in a real terminal', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-settings-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Tokyo Night', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'tokyo-night')
    await expect(page.getByRole('button', { name: 'Tokyo Night', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Настроить горячие клавиши' }).click()
    await page
      .getByRole('button', { name: 'Изменить: Новая локальная консоль', exact: true })
      .click()
    await page.keyboard.press('Control+Alt+y')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Control+Alt+y')
    await expect(page.getByRole('contentinfo')).toContainText('Подключено')
    await expect(page.locator('.session-tab')).toHaveCount(1)
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus()
    await page.keyboard.press('Control+Alt+y')
    await expect(page.locator('.session-tab')).toHaveCount(2)
    expect(
      (await page.evaluate(() => window.terminalApi.settings.get())).shortcutBindings?.[
        'new-local'
      ],
    ).toBe('Ctrl+Alt+Y')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'tokyo-night')
    await page.keyboard.press('Control+Alt+y')
    await expect(page.locator('.session-tab')).toHaveCount(1)
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})

test('light theme reaches terminal and chrome, side docks resize without covering terminal', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-light-docks-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'VS Code Light Modern', exact: true }).click()
    const interval = page.getByLabel('Обновлять мониторинг каждые')
    await interval.fill('8')
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click()
    await expect(page.locator('.terminal-pane.active .xterm-screen')).toBeVisible()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено')
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
    const colors = await page.evaluate(() => ({
      chrome: getComputedStyle(document.querySelector('.window-titlebar')!).backgroundColor,
      terminal: getComputedStyle(document.querySelector('.terminal-pane.active .xterm-screen')!)
        .backgroundColor,
      expected: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }))
    expect(colors.chrome).not.toBe('rgb(30, 30, 30)')
    // Xterm exposes the active palette on its generated screen style.
    const terminalColor = await page
      .locator('.terminal-pane.active .xterm')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(terminalColor).not.toBe('rgb(30, 30, 46)')
    expect(
      (await page.evaluate(() => window.terminalApi.settings.get())).monitoringIntervalSeconds,
    ).toBe(8)
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    await page.getByRole('button', { name: 'Мониторинг', exact: true }).click()
    const width = await page
      .locator('.aux-panel')
      .evaluate((node) => node.getBoundingClientRect().width)
    const resize = page.getByRole('separator', { name: 'Ширина мониторинга', exact: true })
    await resize.focus()
    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(() => page.locator('.aux-panel').evaluate((node) => node.getBoundingClientRect().width))
      .toBeGreaterThan(width)
    const boxes = await page.evaluate(() =>
      ['.terminals', '.file-dock', '.aux-panel'].map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }),
    )
    expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left + 1)
    await page.screenshot({ path: 'test-results/light-docks.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850))
    await expect
      .poll(() => page.locator('.file-dock').evaluate((node) => node.getBoundingClientRect().width))
      .toBeLessThan(380)
    const compactWidth = await page
      .locator('.aux-panel')
      .evaluate((node) => node.getBoundingClientRect().width)
    await resize.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => page.locator('.aux-panel').evaluate((node) => node.getBoundingClientRect().width))
      .toBeLessThan(compactWidth)
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
