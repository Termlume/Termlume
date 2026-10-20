import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('WSL tabs produce independent real output and survive theme change', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-wsl-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.terminalApi?.wsl)
    const distributions = await page.evaluate(() => window.terminalApi.wsl.list())
    const distro = distributions.find((value) => value.startsWith('Ubuntu'))
    test.skip(!distro, 'No Ubuntu WSL distribution available')
    await page.evaluate(async (distribution) => {
      const profile = {
        id: crypto.randomUUID(),
        name: 'WSL test',
        protocol: 'wsl' as const,
        distribution: distribution!,
        favorite: false,
        group: '',
      }
      await window.terminalApi.hosts.save(profile)
    }, distro)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: WSL test' }).click()
    await expect(page.locator('.terminal-pane.active')).toBeVisible()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · WSL', {
      timeout: 20000,
    })
    const originalFontSize = await page.evaluate(
      async () => (await window.terminalApi.settings.get()).terminalFontSize,
    )
    await page.locator('.terminal-pane.active').evaluate((element) => {
      element.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }),
      )
    })
    await expect
      .poll(
        async () => (await page.evaluate(() => window.terminalApi.settings.get())).terminalFontSize,
      )
      .toBe(Math.min(32, originalFontSize + 1))
    const firstId = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    await page.locator('.terminal-pane.active .xterm-helper-textarea').fill('')
    await page
      .locator('.terminal-pane.active .xterm-helper-textarea')
      .pressSequentially('printf WSL_FIRST_MARKER')
    await page.keyboard.press('Enter')
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'WSL_FIRST_MARKER',
    )
    await page.evaluate(async (id) => {
      await window.terminalApi.sessions.write(
        id!,
        'printf "\\nabc\\033["; sleep 0.1; printf "2DX\\n"\r',
      )
    }, firstId)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('aXc')
    await page.evaluate(async (id) => {
      await window.terminalApi.sessions.write(
        id!,
        'printf "\\320"; sleep 0.1; printf "\\237\\320\\240\\320\\230\\320\\222\\320\\225\\320\\242\\n"\r',
      )
    }, firstId)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('ПРИВЕТ')
    await page.getByRole('button', { name: 'Подключиться: WSL test' }).click()
    await expect(page.locator('.session-tab')).toHaveCount(2)
    expect(await page.locator('.terminal-pane.active').getAttribute('data-session-id')).not.toBe(
      firstId,
    )
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Catppuccin Latte', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await page.locator('.session-tab').first().locator('.tab-select').click()
    expect(await page.locator('.terminal-pane.active').getAttribute('data-session-id')).toBe(
      firstId,
    )
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'WSL_FIRST_MARKER',
    )
    await page.evaluate(
      (id) => window.terminalApi.sessions.write(id!, 'vim -Nu NONE -n -i NONE\r'),
      firstId,
    )
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('VIM', {
      timeout: 10000,
    })
    await page.evaluate((id) => window.terminalApi.sessions.write(id!, ':q!\r'), firstId)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'WSL_FIRST_MARKER',
    )
    await page.evaluate((id) => window.terminalApi.sessions.write(id!, 'htop\r'), firstId)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('Tasks', {
      timeout: 10000,
    })
    await page.evaluate((id) => window.terminalApi.sessions.write(id!, 'q'), firstId)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'WSL_FIRST_MARKER',
    )
    await page.evaluate((id) => window.terminalApi.sessions.write(id!, 'sleep 60\r'), firstId)
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus()
    await page.keyboard.press('Control+c')
    const encoded = [...Buffer.from('INTERRUPT_OK')].map((byte) => '\\' + byte.toString(8)).join('')
    await page.evaluate(
      ({ id, encoded }) => window.terminalApi.sessions.write(id!, "printf '" + encoded + "\\n'\r"),
      { id: firstId, encoded },
    )
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText('INTERRUPT_OK')
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
