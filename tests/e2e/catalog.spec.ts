import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('catalogSurvivesRestart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-catalog-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let app = await electron.launch({ args: ['.', '--user-data-dir=' + root], env })
  try {
    let page = await app.firstWindow()
    await page.getByRole('button', { name: 'Новое подключение', exact: true }).first().click()
    await page.getByLabel('Название').fill('Мой сервер')
    await page.getByLabel('Адрес сервера').fill('192.0.2.10')
    await page.getByLabel('Пользователь').fill('admin')
    await page.getByLabel('Порт', { exact: true }).fill('2222')
    await page.getByLabel('Группа').fill('Linux')
    await page.getByLabel('Избранное', { exact: true }).check()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Подключиться: Мой сервер', exact: true }),
    ).toBeVisible()
    await app.close()
    app = await electron.launch({ args: ['.', '--user-data-dir=' + root], env })
    page = await app.firstWindow()
    await expect(
      page.getByRole('button', { name: 'Подключиться: Мой сервер', exact: true }),
    ).toBeVisible()
    const hosts = await page.evaluate(() => window.terminalApi.hosts.list())
    expect(hosts[0]).toMatchObject({ port: 2222, group: 'Linux', favorite: true })
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
