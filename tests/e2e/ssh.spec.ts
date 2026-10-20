import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
test('SSH trust, password, parallel tabs, disconnect and changed host key', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-ssh-e2e-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let server = await sshFixture()
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async (port) => {
      await window.terminalApi.hosts.save({
        id: crypto.randomUUID(),
        name: 'SSH loopback',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'user',
        auth: 'password',
        group: 'Tests',
        favorite: false,
        monitoringEnabled: false,
      })
    }, server.port)
    await page.reload()
    const connect = page.getByRole('button', { name: 'Подключиться: SSH loopback' })
    await connect.click()
    await page.getByLabel('Пароль', { exact: true }).fill('test-password')
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Проверка ключа сервера' })).toBeVisible()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await expect(page.locator('.monitoring-content')).toBeVisible()
    const encryptedSecrets = await readFile(join(data, 'secrets.json'), 'utf8'),
      storedSecrets = JSON.parse(encryptedSecrets) as { data: Record<string, string> }
    expect(Object.keys(storedSecrets.data)).toHaveLength(1)
    expect(encryptedSecrets).not.toContain('test-password')
    const first = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    await page.evaluate((id) => window.terminalApi.sessions.write(id!, 'first-marker'), first)
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'ECHO:first-marker',
    )
    await connect.click()
    await expect(page.locator('.session-tab')).toHaveCount(2)
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await page.locator('.session-tab').first().locator('.tab-select').click()
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(
      'ECHO:first-marker',
    )
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 0,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox
    })
    await page.getByRole('button', { name: 'Закрыть: SSH loopback' }).last().click()
    await expect(page.locator('.session-tab')).toHaveCount(2)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await allowClosing(app)
    const port = server.port
    await server.close()
    await expect(page.getByRole('contentinfo')).toContainText('Связь потеряна')
    await expect(page.getByRole('button', { name: 'Подключиться снова' })).toBeVisible()
    server = await sshFixture({ port })
    await page.getByRole('button', { name: 'Подключиться снова' }).click()
    await expect(page.getByText('Ключ сервера изменился', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Доверять и подключиться' })).toBeDisabled()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(server.authentications).toBe(0)
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
