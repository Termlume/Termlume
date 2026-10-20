import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sshFixture } from '../integration/fixtures/ssh-server'
test('SFTP browser navigates and mutates files without closing shell', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-files-e2e-')),
    remote = join(data, 'remote'),
    local = join(data, 'local'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await mkdir(remote)
  await mkdir(local)
  await writeFile(join(remote, 'Отчёт 2026.txt'), 'remote')
  await writeFile(join(local, 'Local file.txt'), 'local')
  await writeFile(join(local, 'Chosen upload.txt'), 'picker upload')
  const server = await sshFixture({ sftpRoot: remote }),
    app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(
      ({ dialog, shell }, args) => {
        dialog.showOpenDialog = (async (options) => ({
          canceled: false,
          filePaths: options.properties?.includes('openFile') ? [args.file] : [args.directory],
        })) as typeof dialog.showOpenDialog
        shell.openPath = async (path) => {
          ;(globalThis as typeof globalThis & { openedTransferFile?: string }).openedTransferFile =
            path
          return ''
        }
      },
      { directory: local, file: join(local, 'Chosen upload.txt') },
    )
    await page.evaluate(async (port) => {
      const id = crypto.randomUUID()
      await window.terminalApi.hosts.save({
        id,
        name: 'Files test',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'user',
        auth: 'password',
        group: 'Tests',
        favorite: false,
        monitoringEnabled: false,
      })
      await window.terminalApi.hosts.setSecret(id, 'test-password')
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Files test' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    const remotePane = page.locator('.file-side').last(),
      localPane = page.locator('.file-side').first()
    await expect(remotePane.getByText('Отчёт 2026.txt', { exact: true })).toBeVisible()
    await localPane.getByTitle('Выбрать локальную папку', { exact: true }).click()
    await expect(localPane.getByText('Local file.txt', { exact: true })).toBeVisible()
    await localPane.getByText('Local file.txt', { exact: true }).click()
    await localPane.getByRole('button', { name: 'Загрузить', exact: true }).click()
    await expect(remotePane.getByText('Local file.txt', { exact: true })).toBeVisible()
    await expect(page.locator('.transfer-row.completed')).toHaveCount(1)
    await remotePane.getByText('Отчёт 2026.txt', { exact: true }).click()
    await remotePane.getByRole('button', { name: 'Изменить права доступа' }).click()
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Права доступа (octal)' })
      .fill('0750')
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
    await expect(remotePane.getByText('0750 · rwxr-x---', { exact: true })).toBeVisible()
    await remotePane.getByText('Отчёт 2026.txt', { exact: true }).click()
    await remotePane.getByRole('button', { name: 'Скачать', exact: true }).click()
    await expect(localPane.getByText('Отчёт 2026.txt', { exact: true })).toBeVisible()
    await expect(page.locator('.transfer-row.completed')).toHaveCount(2)
    await page.getByRole('button', { name: 'Открыть файл' }).click()
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { openedTransferFile?: string }).openedTransferFile,
      ),
    ).toBe(await realpath(join(local, 'Отчёт 2026.txt')))
    await page.getByRole('button', { name: 'Скрыть очередь передач' }).click()
    await expect(page.locator('.transfer-row')).toHaveCount(0)
    await page.getByRole('button', { name: /Показать очередь передач/ }).click()
    await expect(page.locator('.transfer-row.completed')).toHaveCount(2)
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByLabel('Режим файлового браузера').selectOption('remote-only')
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.getByText('Этот компьютер', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Загрузить файлы…' }).click()
    await expect(remotePane.getByText('Chosen upload.txt', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Очистить завершённые' }).click()
    await expect(page.locator('.transfer-row.completed')).toHaveCount(0)
    await remotePane.getByTitle('Новая папка', { exact: true }).click()
    await page.getByRole('dialog').getByLabel('Имя', { exact: true }).fill('Новая папка')
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(remotePane.getByText('Новая папка', { exact: true })).toBeVisible()
    await remotePane.getByText('Новая папка', { exact: true }).click()
    await remotePane.getByTitle('Удалить', { exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(remotePane.getByText('Новая папка', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
