import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { commands } from '../../src/main/monitoring/commands'
test('live monitoring shares SSH with SFTP and pauses when hidden', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-monitor-e2e-')),
    remote = join(data, 'remote'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await mkdir(remote)
  await writeFile(join(remote, 'server-notes.txt'), 'controlled integration fixture')
  let sample = 0
  const server = await sshFixture({
      sftpRoot: remote,
      execReply: (command) => {
        if (command === commands.os) return { stdout: 'Linux\n' }
        if (command === commands.disks)
          return {
            stdout:
              'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 104857600 35651584 69206016 34% /\n/dev/sdb1 524288000 125829120 398458880 24% /data\n',
          }
        sample++
        return {
          stdout:
            '__TERMINAL_CPU__\ncpu ' +
            sample * 10 +
            ' 0 ' +
            sample * 5 +
            ' ' +
            sample * 85 +
            ' 0 0 0 0\n__TERMINAL_MEM__\nMemTotal: 1048576 kB\nMemAvailable: 524288 kB\nSwapTotal: 262144 kB\nSwapFree: 262144 kB\n__TERMINAL_NET__\neth0: ' +
            sample * 12288 +
            ' 0 0 0 0 0 0 0 ' +
            sample * 6144 +
            ' 0 0 0 0 0 0 0\n__TERMINAL_UPTIME__\n482400.00 100.00\n',
        }
      },
    }),
    app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [directory],
      })) as typeof dialog.showOpenDialog
    }, remote)
    await page.evaluate(async (port) => {
      const id = crypto.randomUUID()
      await window.terminalApi.hosts.save({
        id,
        name: 'Linux integration',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'user',
        auth: 'password',
        group: 'Tests',
        favorite: true,
        monitoringEnabled: false,
      })
      await window.terminalApi.hosts.setSecret(id, 'test-password')
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Linux integration' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await expect(page.locator('.monitoring-content')).toBeVisible()
    await expect(page.getByText('512.0 MB', { exact: true })).toBeVisible()
    await expect(page.getByText('15.0%', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('66.0 GB свободно', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 900, height: 600 })
    await expect(page.getByRole('contentinfo')).toBeVisible()
    expect(
      await page.locator('.aux-panel').evaluate((element) => element.getBoundingClientRect().width),
    ).toBeLessThan(300)
    await expect(page.locator('.monitoring-content')).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    await expect(
      page.locator('.file-side').nth(1).getByText('server-notes.txt', { exact: true }),
    ).toBeVisible()
    await page
      .locator('.file-side')
      .first()
      .getByTitle('Выбрать локальную папку', { exact: true })
      .click()
    await expect(
      page.locator('.file-side').first().getByText('server-notes.txt', { exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: 'docs/verification/screenshots/ssh-sftp-monitoring.png' })
    const id = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Tokyo Night', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    expect(await page.locator('.terminal-pane.active').getAttribute('data-session-id')).toBe(id)
    await page.getByRole('button', { name: 'Мониторинг', exact: true }).click()
    const count = server.execRequests.length
    await page.waitForTimeout(3400)
    expect(server.execRequests.length).toBe(count)
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
