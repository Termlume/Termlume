import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ftpFixture } from '../integration/fixtures/ftp-server'
import { sshFixture } from '../integration/fixtures/ssh-server'
import { commands } from '../../src/main/monitoring/commands'
import { allowClosing } from './helpers'

test('tags, bottom monitoring and a standalone SFTP tab work together', async () => {
  test.setTimeout(60000)
  const root = await mkdtemp(join(tmpdir(), 'termlume-new-features-'))
  const remote = join(root, 'remote'),
    local = join(root, 'local')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'server.txt'), 'server demo')
  await writeFile(join(local, 'upload.txt'), 'local demo')
  await mkdir(join(local, 'folder'))
  await writeFile(join(local, 'folder', 'nested.txt'), 'nested demo')
  const files = await sshFixture({ sftpRoot: remote, fileOnly: true })
  let emptyWho = false
  const linux = await sshFixture({
    execReply: (command) => {
      if (command === commands.os) return { stdout: 'Linux\n' }
      if (command === commands.system) return { stdout: '__TERMINAL_CONNECTIONS__\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=42,fd=3))\nESTAB 0 0 192.0.2.1:22 192.0.2.2:5000 users:(("sshd",pid=43,fd=4))\n__SS_OK__\n' }
      if (command === commands.users)
        return { stdout: emptyWho ? '' : 'demo pts/0 2026-10-20 12:00 (192.0.2.10)\n' }
      if (command === commands.disks)
        return {
          stdout:
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/demo 1000000 200000 800000 20% /\n/dev/data 2000000 100000 1900000 5% /home\n/dev/tmp 100000 1000 99000 1% /tmp\n',
        }
      return {
        stdout:
          '__TERMINAL_CPU__\ncpu 10 0 5 85 0 0 0 0\n__TERMINAL_MEM__\nMemTotal: 1048576 kB\nMemAvailable: 524288 kB\nCached: 262144 kB\nBuffers: 65536 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n__TERMINAL_NET__\neth0: 1024 0 0 0 0 0 0 0 2048 0 0 0 0 0 0 0\n__TERMINAL_UPTIME__\n86400 10\n',
      }
    },
  })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + join(root, 'app')], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [directory],
      })) as typeof dialog.showOpenDialog
    }, local)
    await page.evaluate(
      async ({ filesPort, linuxPort }) => {
        for (const host of [
          {
            id: crypto.randomUUID(),
            name: 'Demo files',
            protocol: 'sftp' as const,
            port: filesPort,
            tags: ['files'],
          },
          {
            id: crypto.randomUUID(),
            name: 'Demo Linux',
            protocol: 'ssh' as const,
            port: linuxPort,
            tags: ['prod'],
            monitoringEnabled: true,
          },
        ]) {
          await window.terminalApi.hosts.save({
            ...host,
            host: '127.0.0.1',
            username: 'user',
            auth: 'password',
            group: 'Demo',
            favorite: true,
          })
          await window.terminalApi.hosts.setSecret(host.id, 'test-password')
        }
        await window.terminalApi.settings.update({
          monitoringPlacement: 'under-terminal',
          themeId: 'vscode-dark-modern',
        })
      },
      { filesPort: files.port, linuxPort: linux.port },
    )
    await page.reload()
    await page.getByRole('button', { name: '#prod', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Подключиться: Demo files' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Сбросить поиск' }).click()
    await page.getByRole('button', { name: 'Подключиться: Demo Linux' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    const bar = page.getByRole('toolbar', { name: 'Мониторинг Demo Linux' })
    const users = bar.getByRole('button', { name: 'Пользователи: demo', exact: true })
    await expect(users).toBeVisible()
    await expect(page.locator('.aux-panel')).toHaveCount(0)
    await users.hover()
    await expect(
      page.getByRole('tooltip').getByRole('cell', { name: 'demo', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await bar.getByRole('button', { name: /^RAM:/ }).hover()
    await expect(page.getByRole('tooltip')).toContainText('Кэш: 256.0 MB')
    await expect(bar.getByRole('button', { name: '/home: 5%', exact: true })).toBeVisible()
    await expect(bar.getByRole('button', { name: '/tmp: 1%', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await bar.click({ button: 'right' })
    await page.getByRole('menuitemcheckbox', { name: 'Процессы', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Сетевые подключения', exact: true }).click()
    await expect
      .poll(async () =>
        page.evaluate(async () =>
          (await window.terminalApi.settings.get()).monitoringItems?.includes('processes'),
        ),
      )
      .toBe(true)
    await page.keyboard.press('Escape')
    await bar.getByRole('button', { name: 'Соединения: 1', exact: true }).hover()
    await expect(page.getByRole('tooltip')).toContainText('0.0.0.0:22')
    await expect(page.getByRole('tooltip')).toContainText('pid=43')
    await page.keyboard.press('Escape')
    emptyWho = true
    await page.getByRole('button', { name: 'Мониторинг', exact: true }).click()
    await page.getByRole('button', { name: 'Мониторинг', exact: true }).click()
    const currentUsers = page.getByRole('button', { name: 'Пользователи: user', exact: true })
    await expect(currentUsers).toBeVisible()
    await currentUsers.hover()
    await expect(page.getByRole('tooltip')).toContainText('Текущее SSH-подключение')
    await expect(page.getByRole('region', { name: 'Подробности мониторинга' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    if (process.env.TERMLUME_PREVIEW_DIR)
      await page.screenshot({ path: join(process.env.TERMLUME_PREVIEW_DIR, 'monitor-bottom.png') })
    await page.getByRole('button', { name: 'Подключиться: Demo files' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    const workspace = page.getByRole('region', { name: 'Файловый клиент: Demo files' })
    await expect(workspace.getByText('server.txt', { exact: true })).toBeVisible()
    await expect(page.locator('.terminals')).not.toBeVisible()
    await workspace.getByTitle('Выбрать локальную папку', { exact: true }).click()
    await workspace.getByText('server.txt', { exact: true }).click()
    await workspace.getByRole('button', { name: 'Скачать', exact: true }).click()
    await expect
      .poll(async () => readFile(join(local, 'server.txt'), 'utf8').catch(() => ''))
      .toBe('server demo')
    await workspace.getByText('folder', { exact: true }).click()
    await workspace.getByRole('button', { name: 'Загрузить', exact: true }).click()
    await expect
      .poll(async () => readFile(join(remote, 'folder', 'nested.txt'), 'utf8').catch(() => ''))
      .toBe('nested demo')
    if (process.env.TERMLUME_PREVIEW_DIR)
      await page.screenshot({ path: join(process.env.TERMLUME_PREVIEW_DIR, 'sftp-workspace.png') })
    expect(files.shellRequests).toBe(0)
    expect(files.ptyRequests).toBe(0)
    expect(files.execRequests).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await files.close()
    await linux.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('standalone FTP tab authenticates, transfers and exposes protocol capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-ftp-ui-'))
  const remote = join(root, 'remote'),
    local = join(root, 'local')
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'ftp-demo.txt'), 'FTP contents')
  const server = await ftpFixture(remote)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + join(root, 'app')], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [directory],
      })) as typeof dialog.showOpenDialog
    }, local)
    await page.evaluate(async (port) => {
      await window.terminalApi.hosts.save({
        id: crypto.randomUUID(),
        name: 'Demo FTP',
        protocol: 'ftp',
        host: '127.0.0.1',
        port,
        username: 'user',
        security: 'none',
        group: '',
        favorite: false,
      })
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Demo FTP' }).click()
    const auth = page.getByRole('dialog', { name: 'Аутентификация FTP' })
    await auth.getByLabel('Пароль').fill('test-password')
    await auth.getByRole('button', { name: 'Подключиться', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'Файловый клиент: Demo FTP' })
    const file = workspace.getByText('ftp-demo.txt', { exact: true })
    await expect(file).toBeVisible()
    await expect(page.locator('.terminals')).not.toBeVisible()
    await workspace.getByTitle('Выбрать локальную папку', { exact: true }).click()
    await file.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Права доступа…' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Вставить путь в терминал' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Скачать', exact: true }).click()
    await expect
      .poll(async () => readFile(join(local, 'ftp-demo.txt'), 'utf8').catch(() => ''))
      .toBe('FTP contents')
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
