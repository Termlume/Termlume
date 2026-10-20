import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('builds, resizes, and removes a four-session split workspace', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-workspace-e2e-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
  try {
    const page = await app.firstWindow()
    for (const name of ['PowerShell', 'Command Prompt', 'PowerShell', 'Command Prompt']) {
      await page
        .getByRole('button', { name: /локальная консоль, избранное и подключение/i })
        .click()
      await page.getByRole('menuitem', { name: new RegExp(name) }).click()
      await expect(page.locator('.terminal-pane.active')).toHaveCount(1)
    }
    await page.setViewportSize({ width: 900, height: 600 })
    for (let count = 1; count < 4; count++) {
      await page.getByRole('button', { name: 'Добавить терминал' }).click()
      const picker = page.getByRole('menu', { name: 'Открытые вкладки' })
      await picker.getByRole('menuitem').first().click()
      await expect(
        page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
      ).toHaveCount(count + 1)
      await expect(page.locator('.split-separator')).toHaveCount(count)
    }
    await page.locator('.split-separator').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(
      page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
    ).toHaveCount(4)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(
      page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
    ).toHaveCount(4)
    for (const [name, expected] of [
      ['Две панели рядом', 2],
      ['Две панели сверху и снизу', 2],
      ['Четыре панели', 4],
    ] as const) {
      await page.getByRole('button', { name }).click()
      await expect(
        page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
      ).toHaveCount(expected)
    }
    const ids = await page
      .locator('.split-session:not([style*="display: none"]) .terminal-pane')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-session-id')))
    expect(new Set(ids).size).toBe(4)
    await page.locator('.split-separator').first().focus()
    await page.keyboard.press('Control+Alt+3')
    await expect(page.locator('.split-separator').first()).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    )
    await page.setViewportSize({ width: 900, height: 600 })
    await page.getByRole('button', { name: 'Четыре панели' }).click()
    await allowClosing(app)
    await page.locator('.session-tab.selected .tab-close').click()
    await expect(page.locator('.session-tab')).toHaveCount(3)
    await expect(
      page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
    ).toHaveCount(3)
    await page.getByRole('button', { name: 'Одна панель' }).click()
    await expect(
      page.locator('.split-session:not([style*="display: none"]) .terminal-pane'),
    ).toHaveCount(1)
    await expect(page.getByRole('contentinfo')).toBeVisible()
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
