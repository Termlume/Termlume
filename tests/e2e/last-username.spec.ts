import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { allowClosing } from './helpers'

test('successful shared SSH login becomes the persisted default for new connections', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-last-user-'))
  const server = await sshFixture({ username: 'shvv' })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async (port) => {
      await window.terminalApi.settings.update({ lastUsername: 'previous-user' })
      const identity = await window.terminalApi.identities.save(
        { id: crypto.randomUUID(), name: 'Company', username: 'shvv', method: 'password' },
        'test-password',
      )
      const profile = await window.terminalApi.hosts.save({
        id: crypto.randomUUID(),
        name: 'Test host',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'root',
        identityId: identity.id,
        auth: 'password',
        group: '',
        favorite: false,
      })
      await window.terminalApi.sessions.open(profile.id)
    }, server.port)
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect
      .poll(() => page.evaluate(async () => (await window.terminalApi.settings.get()).lastUsername))
      .toBe('shvv')
    expect(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).data.lastUsername).toBe(
      'shvv',
    )
    await page.getByRole('button', { name: 'Новое подключение', exact: true }).first().click()
    await expect(page.getByLabel('Пользователь', { exact: true })).toHaveValue('shvv')
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Новое подключение', exact: true }).first().click()
    await expect(page.getByLabel('Пользователь', { exact: true })).toHaveValue('shvv')
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
