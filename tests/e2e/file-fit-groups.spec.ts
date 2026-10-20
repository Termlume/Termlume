import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { allowClosing } from './helpers'

test('host groups reorder persistently and every file column stays inside narrow tables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-fit-groups-'))
  const remote = join(root, 'remote')
  await mkdir(remote)
  await writeFile(join(remote, 'long-configuration-file.conf'), 'demo')
  const server = await sshFixture({ sftpRoot: remote, fileOnly: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + join(root, 'app')], env })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async (port) => {
      for (const group of ['A', 'B', 'C']) {
        const id = crypto.randomUUID()
        await window.terminalApi.hosts.save({
          id,
          name: group === 'A' ? 'Files' : group,
          group,
          protocol: 'sftp',
          host: '127.0.0.1',
          port,
          username: 'user',
          auth: 'password',
          favorite: false,
          tags: [],
        })
        await window.terminalApi.hosts.setSecret(id, 'test-password')
      }
    }, server.port)
    await page.reload()
    const order = () =>
      page
        .locator('.host-group')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-group')))
    const groupC = page.locator('.host-group[data-group="C"] > .host-group-title')
    await groupC.click()
    await groupC.dragTo(page.locator('.host-group[data-group="A"] > .host-group-title'))
    await expect.poll(order).toEqual(['C', 'A', 'B'])
    await expect(groupC).toHaveAttribute('aria-expanded', 'false')
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.terminalApi.settings.get()).hostGroupOrder),
      )
      .toEqual(['C', 'A', 'B'])
    await page.reload()
    await expect.poll(order).toEqual(['C', 'A', 'B'])
    await groupC.focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(order).toEqual(['A', 'C', 'B'])
    await page.getByRole('button', { name: 'Подключиться: Files', exact: true }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    const workspace = page.getByRole('region', { name: 'Файловый клиент: Files' })
    await expect(workspace.getByText('long-configuration-file.conf', { exact: true })).toBeVisible()
    const check = async () => {
      for (const table of await workspace.locator('.file-table').all()) {
        const geometry = await table.evaluate((node) => {
          const wrap = node.parentElement!,
            r = wrap.getBoundingClientRect()
          return {
            client: wrap.clientWidth,
            scroll: wrap.scrollWidth,
            right: node.getBoundingClientRect().right,
            edge: r.right,
            columns: [...node.querySelectorAll('th')].map((th) => {
              const box = th.getBoundingClientRect()
              return { left: box.left, right: box.right, width: box.width }
            }),
            left: r.left,
          }
        })
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
        expect(geometry.right).toBeLessThanOrEqual(geometry.edge + 1)
        for (const col of geometry.columns) {
          expect(col.width).toBeGreaterThan(0)
          expect(col.left).toBeGreaterThanOrEqual(geometry.left - 1)
          expect(col.right).toBeLessThanOrEqual(geometry.edge + 1)
        }
      }
    }
    await check()
    const remoteTable = workspace.locator('.file-side').nth(1).locator('.file-table')
    await expect(remoteTable.getByRole('columnheader')).toHaveCount(6)
    await remoteTable.getByRole('separator', { name: 'Ширина: Имя', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await check()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900)
    await check()
    await workspace
      .locator('.file-table-wrap')
      .evaluateAll((nodes) => nodes.forEach((n) => ((n as HTMLElement).style.maxWidth = '280px')))
    await check()
    await page.screenshot({ path: 'test-results/file-columns-narrow.png' })
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
