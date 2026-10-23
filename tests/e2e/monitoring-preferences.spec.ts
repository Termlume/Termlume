import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'
import { sshFixture } from '../integration/fixtures/ssh-server'

test('metric toggles follow settings order and survive restart independently per server', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-monitor-prefs-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const server = await sshFixture()
  let app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    let page = await app.firstWindow()
    await page.evaluate(async (port) => {
      await window.terminalApi.settings.update({
        monitoringPlacement: 'under-terminal',
        monitoringItems: ['host', 'ram', 'temperatures', 'cpu'],
        monitoringOrder: ['host', 'ram', 'temperatures', 'cpu'],
      })
      for (const name of ['Server A', 'Server B']) {
        const id = crypto.randomUUID()
        await window.terminalApi.hosts.save({
          id,
          name,
          protocol: 'ssh',
          host: '127.0.0.1',
          port,
          username: 'user',
          auth: 'password',
          group: 'Tests',
          favorite: false,
        })
        await window.terminalApi.hosts.setSecret(id, 'test-password')
      }
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Server A', exact: true }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    const toolbar = page.getByRole('toolbar', { name: 'Мониторинг Server A' })
    const labels = () =>
      toolbar
        .locator('.monitoring-item')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')?.split(':')[0]))
    await expect.poll(labels).toEqual(['Сервер', 'RAM', 'Температуры', 'CPU'])
    await toolbar.click({ button: 'right' })
    const toggle = page.getByRole('menuitemcheckbox', { name: 'Температуры', exact: true })
    await toggle.click()
    await expect.poll(labels).toEqual(['Сервер', 'RAM', 'CPU'])
    await toggle.click()
    await expect.poll(labels).toEqual(['Сервер', 'RAM', 'Температуры', 'CPU'])
    await toggle.click()
    await page.keyboard.press('Escape')
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.terminalApi.hosts.list()).find((host) => host.name === 'Server A')
              ?.monitoringItems,
        ),
      )
      .toEqual(['host', 'ram', 'cpu'])
    await page.getByRole('button', { name: 'Подключиться: Server B', exact: true }).click()
    await expect(
      page
        .getByRole('toolbar', { name: 'Мониторинг Server B' })
        .getByRole('button', { name: /^Температуры:/ }),
    ).toBeVisible()
    await allowClosing(app)
    await app.close()
    app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
    page = await app.firstWindow()
    await page.getByRole('button', { name: 'Подключиться: Server A', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: 'Мониторинг Server A' })).toBeVisible()
    await expect(
      page.getByRole('toolbar').getByRole('button', { name: /^Температуры:/ }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Подключиться: Server B', exact: true }).click()
    await expect(
      page
        .getByRole('toolbar', { name: 'Мониторинг Server B' })
        .getByRole('button', { name: /^Температуры:/ }),
    ).toBeVisible()
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
