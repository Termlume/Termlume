import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('SSH identities persist metadata, discover keys and use the native key picker', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-identities-e2e-')),
    keyPath = join(data, 'identity-key'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await writeFile(keyPath, 'test key placeholder')
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path],
      })) as typeof dialog.showOpenDialog
    }, keyPath)
    const picked = await page.evaluate(() => window.terminalApi.identities.chooseKey())
    expect(picked).toBe(keyPath)

    const identity = {
      id: crypto.randomUUID(),
      name: 'Router key',
      method: 'key' as const,
      keyPath,
    }
    await page.evaluate((value) => window.terminalApi.identities.save(value), identity)
    const saved = await page.evaluate(() => window.terminalApi.identities.list())
    expect(saved).toEqual([identity])

    const discovered = await page.evaluate(() => window.terminalApi.identities.discoverSsh())
    expect(
      discovered.every(
        (entry) => entry.id && entry.name && ['key', 'agent'].includes(entry.method),
      ),
    ).toBe(true)
    expect(discovered.every((entry) => !('secret' in entry))).toBe(true)

    await page.evaluate((id) => window.terminalApi.identities.remove(id), identity.id)
    expect(await page.evaluate(() => window.terminalApi.identities.list())).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
