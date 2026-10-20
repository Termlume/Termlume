import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { allowClosing } from './helpers'

test('capture isolated demonstration workspace', async () => {
  test.skip(process.env.TERMLUME_SCREENSHOTS !== '1', 'Opt-in documentation screenshots')
  const root = await mkdtemp(join(tmpdir(), 'termlume-demo-'))
  const remote = join(root, 'remote')
  await mkdir(remote)
  await mkdir('docs/images', { recursive: true })
  for (const folder of ['backups', 'config', 'logs', 'projects']) await mkdir(join(remote, folder))
  for (const [name, text] of Object.entries({
    'compose.yml': 'services:\n  web:\n    image: nginx:stable\n',
    'README.md': '# Demo server\n',
    'deploy.sh': '#!/bin/sh\necho Deployment complete\n',
    'nginx.conf': 'server { listen 80; }\n',
    'settings.json': '{"environment":"demo"}\n',
  }))
    await writeFile(join(remote, name), text)
  let count = 0
  const greeting =
    '\x1b[2J\x1b[H\x1b[1;36mWelcome to Ubuntu 24.04 LTS\x1b[0m\r\n\r\n  Demo workspace  /  web-01.example.com\r\n  All data shown here is fictional.\r\n\r\n\x1b[32mdemo@web-01\x1b[0m:~$ docker compose ps\r\nNAME          IMAGE           STATUS          PORTS\r\nweb           nginx:stable    Up 12 days      0.0.0.0:80->80/tcp\r\napi           app:1.4.2       Up 12 days      0.0.0.0:8080->8080/tcp\r\npostgres      postgres:16     Up 12 days      5432/tcp\r\n\r\n\x1b[32mdemo@web-01\x1b[0m:~$ ./deploy.sh\r\n[OK] Configuration validated\r\n[OK] Services are healthy\r\n[OK] Deployment completed in 2.4s\r\n\r\n\x1b[32mdemo@web-01\x1b[0m:~$ '
  const server = await sshFixture({
    sftpRoot: remote,
    shellGreeting: greeting,
    execReply(command) {
      if (command.startsWith('getent passwd')) return { stdout: 'demo:x:0:0::/home/demo:/bin/bash' }
      if (command.startsWith('getent group')) return { stdout: 'demo:x:0:' }
      if (command === 'uname -s') return { stdout: 'Linux' }
      if (command === 'LC_ALL=C df -Pk')
        return {
          stdout:
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 104857600 32505856 72351744 31% /\n/dev/vdb1 524288000 152043520 372244480 29% /data',
        }
      count++
      return {
        stdout:
          '__TERMINAL_CPU__\ncpu ' +
          count * 140 +
          ' 0 0 ' +
          count * 860 +
          ' 0 0 0 0\n__TERMINAL_MEM__\nMemTotal: 16777216 kB\nMemAvailable: 9961472 kB\nSwapTotal: 4194304 kB\nSwapFree: 4194304 kB\n__TERMINAL_NET__\neth0: ' +
          count * 140000 +
          ' 0 0 0 0 0 0 0 ' +
          count * 260000 +
          ' 0 0 0 0 0 0 0\n__TERMINAL_UPTIME__\n1036800.0 0.0',
      }
    },
  })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: ['.', '--user-data-dir=' + join(root, 'profile')],
    env,
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080))
    await page.evaluate(async (port) => {
      await window.terminalApi.settings.update({
        themeId: 'catppuccin-mocha',
        sidebarWidth: 240,
        monitorWidth: 260,
        sftpWidth: 700,
        sftpMode: 'remote-only',
        terminalFontSize: 13,
      })
      for (const [index, name, host, group] of [
        [0, 'web-01 · demo', '127.0.0.1', 'Production'],
        [1, 'api-01', '192.0.2.20', 'Production'],
        [2, 'database', '192.0.2.30', 'Production'],
        [3, 'dev-box', '198.51.100.10', 'Development'],
        [4, 'edge-router', '203.0.113.1', 'Network'],
      ] as const) {
        const id = '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')
        await window.terminalApi.hosts.save({
          id,
          name,
          host,
          group,
          protocol: 'ssh',
          port: index === 0 ? port : 22,
          username: 'demo',
          auth: 'password',
          favorite: index < 2,
          monitoringEnabled: true,
        })
        if (index === 0) await window.terminalApi.hosts.setSecret(id, 'test-password')
      }
    }, server.port)
    await page.reload()
    await page
      .getByRole('button', { name: 'Подключиться: web-01 · demo', exact: true })
      .first()
      .click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено')
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    await expect(page.getByText('compose.yml', { exact: true })).toBeVisible()
    await expect(page.locator('.monitoring-content')).toBeVisible()
    await page.waitForTimeout(6300)
    await page.screenshot({ path: 'docs/images/overview-dark.png' })
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'VS Code Light Modern', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.screenshot({ path: 'docs/images/overview-light.png' })
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
