import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { decodePortableBackup } from '../../src/main/storage/portable-backup'

test('encrypted backup restores credentials, identities, favorites, and selected settings', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-data-transfer-')),
    backup = join(data, 'portable.ptbackup'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const server = await sshFixture(),
    app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
  try {
    const page = await app.firstWindow(),
      ids = await page.evaluate(async (port) => {
        const hostId = crypto.randomUUID(),
          identityId = crypto.randomUUID()
        await window.terminalApi.identities.save({
          id: identityId,
          name: 'Portable router key',
          method: 'password',
          keyPath: 'C:\\Users\\test\\.ssh\\router.key',
        })
        const host = await window.terminalApi.hosts.save({
          id: hostId,
          name: 'Portable router',
          protocol: 'ssh',
          host: '127.0.0.1',
          port,
          username: 'user',
          auth: 'password',
          identityId,
          favorite: true,
          group: 'Routers',
          monitoringEnabled: false,
        })
        await window.terminalApi.hosts.setSecret(hostId, 'test-password')
        await window.terminalApi.settings.update({ themeId: 'tokyo-night', localShell: 'cmd' })
        return { host, identityId }
      }, server.port)
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: path,
      })) as typeof dialog.showSaveDialog
    }, backup)
    await page.evaluate(() => window.terminalApi.data.export('correct horse battery staple'))
    const archive = await readFile(backup, 'utf8')
    expect(archive).not.toContain('test-password')
    expect(archive).not.toContain('PRIVATE KEY')
    await page.evaluate(
      async ({ hostId, profile }) => {
        await window.terminalApi.hosts.save({
          ...profile,
          id: hostId,
          name: 'Changed router',
          favorite: false,
        })
        await window.terminalApi.settings.update({ themeId: 'one-dark', localShell: 'powershell' })
      },
      { hostId: ids.host.id, profile: ids.host },
    )
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path],
      })) as typeof dialog.showOpenDialog
    }, backup)
    const preview = await page.evaluate(() =>
      window.terminalApi.data.previewImport('correct horse battery staple'),
    )
    expect(preview?.conflicts).toEqual({ hosts: 1, identities: 1, knownHosts: 0 })
    const localSession = await page.evaluate(() => window.terminalApi.sessions.openLocal('cmd'))
    const blockedImport = await page.evaluate(async (token) => {
      try {
        await window.terminalApi.data.commitImport(token, 'merge')
        return ''
      } catch (error) {
        return String(error)
      }
    }, preview!.token)
    expect(blockedImport).toContain('Закройте активные сеансы')
    await page.evaluate((id) => window.terminalApi.sessions.close(id), localSession)
    await page.evaluate(
      async (token) => window.terminalApi.data.commitImport(token, 'merge'),
      preview!.token,
    )
    const restored = await page.evaluate(
      async ({ hostId, identityId }) => ({
        host: (await window.terminalApi.hosts.list()).find((entry) => entry.id === hostId),
        identity: (await window.terminalApi.identities.list()).find(
          (entry) => entry.id === identityId,
        ),
        settings: await window.terminalApi.settings.get(),
      }),
      { hostId: ids.host.id, identityId: ids.identityId },
    )
    expect(restored.host?.favorite).toBe(true)
    expect(restored.host?.name).toBe('Portable router')
    expect(restored.identity?.keyPath).toBe('C:\\Users\\test\\.ssh\\router.key')
    expect(restored.settings.themeId).toBe('one-dark')
    const importedHostStore = JSON.parse(await readFile(join(data, 'app', 'hosts.json'), 'utf8')),
      importedSecretStore = JSON.parse(await readFile(join(data, 'app', 'secrets.json'), 'utf8'))
    expect(importedHostStore.data[0].secretRef).toBe(ids.host.id)
    expect(importedSecretStore.data[ids.host.id]).toBeTruthy()
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: path,
        })) as typeof dialog.showSaveDialog
      },
      join(data, 'after-import.ptbackup'),
    )
    await page.evaluate(() => window.terminalApi.data.export('correct horse battery staple'))
    const exportedAgain = await decodePortableBackup(
      await readFile(join(data, 'after-import.ptbackup')),
      'correct horse battery staple',
    )
    expect(exportedAgain.secrets[ids.host.id]).toBe('test-password')
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Portable router' }).click()
    await expect(page.getByRole('dialog', { name: 'Проверка ключа сервера' })).toBeVisible()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    expect(server.authentications).toBeGreaterThan(0)
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
