import { expect, test, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Termlume loads the existing Terminal AppData catalog after the rebrand', async () => {
  const appData = await mkdtemp(join(tmpdir(), 'termlume-legacy-appdata-')),
    legacyUserData = join(appData, 'Terminal'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await mkdir(legacyUserData)
  await writeFile(
    join(legacyUserData, 'hosts.json'),
    JSON.stringify({
      schemaVersion: 1,
      data: [
        {
          id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
          name: 'Legacy Linux server',
          protocol: 'ssh',
          host: '192.0.2.20',
          port: 22,
          username: 'admin',
          auth: 'password',
          favorite: true,
          group: 'Linux',
          monitoringEnabled: false,
        },
      ],
    }),
  )
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + legacyUserData], env })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.terminalApi)
    expect(await page.title()).toBe('Termlume')
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(legacyUserData)
    await expect(
      page.getByRole('button', { name: 'Подключиться: Legacy Linux server', exact: true }),
    ).toBeVisible()
  } finally {
    await app.close()
    await rm(appData, { recursive: true, force: true })
  }
})
