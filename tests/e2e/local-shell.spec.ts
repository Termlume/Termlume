import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('new tab menu remains visible inside the minimum window', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-tab-menu-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 900, height: 600 })
    await page.getByRole('button', { name: /локальная консоль, избранное и подключение/i }).click()
    const menu = page.getByRole('menu', { name: 'Новая вкладка' })
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('Локальная консоль, избранное или новое подключение')
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(900)
    expect(box!.y + box!.height).toBeLessThanOrEqual(600)
    expect(
      await page.evaluate(({ x, y }) => {
        return document.elementFromPoint(x, y)?.closest('[role="menu"]') !== null
      }, { x: box!.x + 16, y: box!.y + 16 }),
    ).toBe(true)
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})

test('new tab opens PowerShell and cmd and removes each tab after logout', async () => {
  test.skip(process.platform !== 'win32', 'Windows local shells')
  const data = await mkdtemp(join(tmpdir(), 'terminal-local-shell-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Новая вкладка' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · LOCAL')
    const initialFontSize = await page.evaluate(() =>
      window.terminalApi.settings.get().then((settings) => settings.terminalFontSize),
    )
    await page.locator('.terminal-pane.active').dispatchEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.terminalApi.settings.get().then((settings) => settings.terminalFontSize),
        ),
      )
      .toBe(initialFontSize + 1)
    let id = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    await page.evaluate(
      (sessionId) => window.terminalApi.sessions.write(sessionId!, 'Write-Output LOCAL_PS_OK\r'),
      id,
    )
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('LOCAL_PS_OK')
    await expect
      .poll(async () => {
        const text = await page.locator('.terminal-pane.active .xterm-rows').innerText()
        return text.split('LOCAL_PS_OK').length - 1
      })
      .toBeGreaterThanOrEqual(2)
    await page.evaluate(
      (sessionId) => window.terminalApi.sessions.write(sessionId!, 'exit\r\n'),
      id,
    )
    await expect(page.locator('.session-tab')).toHaveCount(0)

    await page
      .getByRole('button', { name: /локальная консоль, избранное и подключение/i })
      .click()
    await page.getByRole('menuitem', { name: 'Command Prompt' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · LOCAL')
    id = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    await page.evaluate(
      (sessionId) => window.terminalApi.sessions.write(sessionId!, 'echo LOCAL_CMD_OK\r'),
      id,
    )
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('LOCAL_CMD_OK')
    await page.evaluate(
      (sessionId) => window.terminalApi.sessions.write(sessionId!, 'exit\r\n'),
      id,
    )
    await expect(page.locator('.session-tab')).toHaveCount(0)
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})

test('keyboard shortcuts open, cycle, and close session tabs without closing Termlume', async () => {
  test.skip(process.platform !== 'win32', 'Windows local shells')
  const data = await mkdtemp(join(tmpdir(), 'terminal-shortcuts-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Новая вкладка' }).click()
    await expect(page.locator('.session-tab')).toHaveCount(1)
    await page.keyboard.press('Control+Alt+T')
    await expect(page.locator('.session-tab')).toHaveCount(2)
    const firstActive = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    const relayShortcut = (key: string, shiftKey = false) =>
      app.evaluate(
        ({ BrowserWindow }, shortcut) => {
          BrowserWindow.getAllWindows()[0].webContents.send('terminal:shortcut', {
            key: shortcut.key,
            ctrlKey: true,
            shiftKey: shortcut.shiftKey,
          })
        },
        { key, shiftKey },
      )
    await relayShortcut('Tab')
    await expect
      .poll(() => page.locator('.terminal-pane.active').getAttribute('data-session-id'))
      .not.toBe(firstActive)
    await relayShortcut('Tab', true)
    await expect(page.locator('.terminal-pane.active')).toHaveAttribute(
      'data-session-id',
      firstActive!,
    )
    await relayShortcut('W')
    await expect(page.locator('.session-tab')).toHaveCount(1)
    await expect(page).toHaveTitle('Termlume')
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
