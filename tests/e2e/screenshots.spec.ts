import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { allowClosing } from './helpers'
import { commands } from '../../src/main/monitoring/commands'

test('capture isolated demonstration workspace', async () => {
  test.skip(process.env.TERMLUME_SCREENSHOTS !== '1', 'Opt-in documentation screenshots')
  const root = await mkdtemp(join(tmpdir(), 'termlume-demo-'))
  const remote = join(root, 'remote')
  const local = join(process.cwd(), 'test-results', 'readme-demo-files')
  await mkdir(local, { recursive: true })
  await writeFile(join(local, 'compose.yml'), 'services:\n  web:\n    image: nginx:stable\n')
  await writeFile(join(local, 'deploy.sh'), '#!/bin/sh\necho Deploy\n')
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
      if (command === commands.users)
        return { stdout: 'demo pts/0 2026-10-20 12:00 (192.0.2.10)\n' }
      if (command === commands.system)
        return {
          stdout:
            '__TERMINAL_HOST__\nweb-01\n__TERMINAL_PROCESSES__\nS\nR\nS\n__PS_OK__\n__TERMINAL_LOAD__\n0.14 0.18 0.21 1/128 1245\n__TERMINAL_FILES__\n1024 0 1048576\n__TERMINAL_MOUNTS__\n/dev/vda1 / ext4 rw 0 0\n__MOUNTS_OK__\n__TERMINAL_CONNECTIONS__\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n__SS_OK__\n',
        }
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 900))
    await page.evaluate(async (port) => {
      await window.terminalApi.settings.update({
        themeId: 'catppuccin-mocha',
        sidebarWidth: 240,
        monitorWidth: 260,
        sftpWidth: 410,
        monitoringPlacement: 'under-terminal',
        monitoringIntervalSeconds: 1,
        macros: [
          {
            id: 'logs',
            name: 'logs',
            description: 'Последние записи журнала',
            command: 'journalctl -n 50 --no-pager',
          },
          {
            id: 'services',
            name: 'services',
            description: 'Состояние служб',
            command: 'systemctl --failed',
          },
          { id: 'disk', name: 'disk', description: 'Свободное место на дисках', command: 'df -h' },
        ],
        sftpMode: 'remote-only',
        terminalFontSize: 16,
        collapsedHostGroups: ['Development', 'Network'],
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
          tags:
            group === 'Production'
              ? ['prod', index === 2 ? 'database' : 'web']
              : group === 'Network'
                ? ['network']
                : ['dev'],
          host,
          group,
          protocol: 'ssh',
          port: index === 0 ? port : 22,
          username: 'demo',
          auth: 'password',
          favorite: index < 2,
          monitoringEnabled: true,
        })
        if (index === 0) {
          await window.terminalApi.hosts.setSecret(id, 'test-password')
          const filesId = '00000000-0000-4000-8000-000000000099'
          await window.terminalApi.hosts.save({
            id: filesId,
            name: 'Deploy files',
            protocol: 'sftp',
            host: '127.0.0.1',
            port,
            username: 'demo',
            auth: 'password',
            group: 'Production',
            favorite: false,
            tags: ['files'],
          })
          await window.terminalApi.hosts.setSecret(filesId, 'test-password')
        }
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
    await expect(page.getByRole('toolbar', { name: 'Мониторинг web-01 · demo' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Пользователи: demo', exact: true }),
    ).toBeVisible()
    await page.waitForTimeout(2300)
    const assertPrivacy = async () => {
      const visible = await page.evaluate(
        () =>
          document.body.innerText +
          '\n' +
          [...document.querySelectorAll('input')].map((input) => input.value).join('\n'),
      )
      for (const value of [process.env.USERNAME, process.env.USERPROFILE])
        if (value) expect(visible.toLowerCase()).not.toContain(value.toLowerCase())
    }
    await assertPrivacy()
    await page.screenshot({ path: 'docs/images/overview-dark.png' })
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'VS Code Light Modern', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await assertPrivacy()
    await page.screenshot({ path: 'docs/images/overview-light.png' })
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Catppuccin Mocha', exact: true }).click()
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus()
    await page.keyboard.type('/')
    await expect(page.getByRole('listbox', { name: 'Доступные макросы' })).toBeVisible()
    await assertPrivacy()
    await page.locator('.terminal-macros').screenshot({ path: 'docs/images/macros.png' })
    await page.keyboard.press('Escape')
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [directory],
      })) as typeof dialog.showOpenDialog
    }, local)
    await page.getByRole('button', { name: 'Подключиться: Deploy files', exact: true }).click()
    const files = page.getByRole('region', { name: 'Файловый клиент: Deploy files' })
    await expect(files.getByText('compose.yml', { exact: true })).toBeVisible()
    await files.getByTitle('Выбрать локальную папку', { exact: true }).click()
    await expect(
      files.locator('.file-side').first().getByText('deploy.sh', { exact: true }),
    ).toBeVisible()
    await assertPrivacy()
    await page.screenshot({ path: 'docs/images/file-client.png' })
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
    await rm(local, { recursive: true, force: true })
  }
})
