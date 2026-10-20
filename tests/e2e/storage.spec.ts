import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('Windows vault encrypts and decrypts a temporary secret', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-vault-e2e-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.terminalApi)
    await page.evaluate(async () => {
      await window.terminalApi.hosts.save({
        id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
        name: 'test',
        protocol: 'ssh',
        host: 'localhost',
        port: 22,
        username: 'test',
        auth: 'password',
        favorite: false,
        group: '',
        monitoringEnabled: false,
      })
      await window.terminalApi.hosts.setSecret(
        'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
        'temporary-probe-secret',
      )
    })
    const document = await readFile(join(data, 'secrets.json'), 'utf8')
    expect(document).not.toContain('temporary-probe-secret')
    const encrypted = JSON.parse(document).data['c8019a9d-5f81-4836-8b97-cb6c44b19c1d']
    expect(
      await app.evaluate(
        ({ safeStorage }, value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
        encrypted,
      ),
    ).toBe('temporary-probe-secret')
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})

test('interaction settings survive application restart', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-settings-e2e-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.terminalApi)
    await page.evaluate(() =>
      window.terminalApi.settings.update({
        sftpMode: 'remote-only',
        mouseAction: 'manual',
        localShell: 'cmd',
        smoothInput: true,
      }),
    )
    await app.close()
    app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
    const reopened = await app.firstWindow()
    await reopened.waitForFunction(() => !!window.terminalApi)
    await expect
      .poll(async () => reopened.evaluate(() => window.terminalApi.settings.get()))
      .toMatchObject({
        sftpMode: 'remote-only',
        mouseAction: 'manual',
        localShell: 'cmd',
        smoothInput: true,
      })
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
