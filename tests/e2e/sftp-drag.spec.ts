import { allowClosing } from './helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { sshFixture } from '../integration/fixtures/ssh-server'

test('remote file is immediately draggable without hover downloads or preparation', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-sftp-drag-e2e-')),
    remote = join(data, 'remote'),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await mkdir(remote)
  await writeFile(join(remote, 'router.conf'), 'hostname edge-router')
  const server = await sshFixture({ sftpRoot: remote }),
    app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async (port) => {
      const id = crypto.randomUUID()
      await window.terminalApi.hosts.save({
        id,
        name: 'Router drag test',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'user',
        auth: 'password',
        group: '',
        favorite: false,
        monitoringEnabled: false,
      })
      await window.terminalApi.hosts.setSecret(id, 'test-password')
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Router drag test' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    await page.getByRole('button', { name: 'Файлы', exact: true }).click()
    const row = page.getByText('router.conf', { exact: true }).locator('xpath=ancestor::tr')
    await expect(row).toHaveAttribute('draggable', 'true')
    await row.click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: 'Открыть с помощью…', exact: true }),
    ).toBeVisible()
    await page.getByRole('menuitem', { name: 'Свойства', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Свойства файла' })).toContainText('router.conf')
    await page.getByRole('button', { name: 'ОК', exact: true }).click()
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Права доступа…', exact: true }).click()
    await expect(page.getByLabel('Символьные права')).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(9)
    await page.screenshot({ path: 'test-results/file-permissions.png' })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await row.hover()
    await row.click()
    await expect(row).toHaveAttribute('draggable', 'true')
    await expect(page.locator('.transfer-row.completed')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Подготовить/ })).toHaveCount(0)
    await expect(row).toHaveAttribute('draggable', 'true')
    await app.evaluate(({ shell }) => {
      shell.openPath = async () => new Promise<string>((done) => setTimeout(() => done(''), 350))
    })
    const progress = page.evaluate(
      () =>
        new Promise<{ completed: number; total?: number }>((done) => {
          const off = window.terminalApi.files.onActivity((activity) => {
            if (activity.kind === 'open' && activity.completed > 0) {
              off()
              done(activity)
            }
          })
        }),
    )
    await row.dblclick()
    await expect(row.getByRole('progressbar')).toBeVisible()
    expect((await progress).completed).toBeGreaterThan(0)
    await expect(row.getByRole('progressbar')).toHaveCount(0)
    // External drops may come from outside the folder shown in the local panel.
    const selectedLocal = join(data, 'selected-local')
    const droppedFile = join(data, 'desktop-upload.txt')
    await mkdir(selectedLocal)
    await writeFile(droppedFile, 'external desktop upload')
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, selectedLocal)
    await page.evaluate(() => window.terminalApi.files.chooseLocal())
    await page.evaluate(async (source) => {
      const sessionId = document
        .querySelector('.terminal-pane.active')!
        .getAttribute('data-session-id')!
      const listing = await window.terminalApi.files.list({ side: 'remote', sessionId, path: '.' })
      await window.terminalApi.files.enqueueDropped([source], sessionId, listing.path)
    }, droppedFile)
    await expect
      .poll(async () => {
        try {
          return await readFile(join(remote, 'desktop-upload.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toBe('external desktop upload')
    expect(await page.evaluate(() => window.terminalApi.files.localRoot())).toBe(selectedLocal)
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})

for (const folder of [false, true])
  test(`FileList HTML drag transitions to native OLE and drops real SSH ${folder ? 'folders' : 'bytes'} onto desktop and Explorer`, async () => {
    test.skip(
      process.platform !== 'win32' || process.env.TERMLUME_NATIVE_UI_TESTS !== '1',
      'Requires the interactive Windows desktop',
    )
    const data = await mkdtemp(join(tmpdir(), 'termlume-desktop-drop-')),
      remote = join(data, 'remote')
    await mkdir(remote)
    const name = `termlume-drop-${randomUUID()}${folder ? '' : '.bin'}`,
      bytes = randomBytes(512 * 1024 + 37)
    if (folder) await mkdir(join(remote, name, 'nested', 'empty'), { recursive: true })
    await writeFile(folder ? join(remote, name, 'nested', 'bytes.bin') : join(remote, name), bytes)
    const server = await sshFixture({ sftpRoot: remote }),
      env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({ args: ['.', '--user-data-dir=' + join(data, 'app')], env })
    let driver: ReturnType<typeof spawn> | undefined
    let targets: string[] = []
    try {
      const page = await app.firstWindow()
      await page.evaluate(async (port) => {
        const id = crypto.randomUUID()
        await window.terminalApi.hosts.save({
          id,
          name: 'Desktop drop',
          protocol: 'ssh',
          host: '127.0.0.1',
          port,
          username: 'user',
          auth: 'password',
          group: '',
          favorite: false,
          monitoringEnabled: false,
        })
        await window.terminalApi.hosts.setSecret(id, 'test-password')
      }, server.port)
      await page.reload()
      await page.getByRole('button', { name: 'Подключиться: Desktop drop' }).click()
      await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
      await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
      await page.getByRole('button', { name: 'Файлы', exact: true }).click()
      const row = page.getByText(name, { exact: true }).locator('xpath=ancestor::tr')
      await expect(row).toHaveAttribute('draggable', 'true')
      await page.evaluate(() => {
        const state = { started: 0, ended: 0 }
        Object.assign(window, { dragGestureState: state })
        document.addEventListener('dragstart', () => state.started++)
        document.addEventListener('dragend', () => state.ended++)
      })
      const sourceWindow = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.unmaximize()
        window.setBounds({ x: 20, y: 20, width: 1000, height: 700 })
        return window.getNativeWindowHandle().readBigUInt64LE().toString(16)
      })
      const explorerDirectory = join(data, 'explorer-target')
      await mkdir(explorerDirectory)
      for (const mode of ['desktop', 'explorer']) {
        driver = spawn(
          resolve('native/windows-drag/bin/Termlume.FileDrag.exe'),
          mode === 'desktop'
            ? ['--desktop-gesture-test', sourceWindow]
            : ['--explorer-gesture-test', explorerDirectory, sourceWindow],
          { windowsHide: true, stdio: 'pipe' },
        )
        const messages: { type: string; directory?: string; error?: string }[] = []
        createInterface({ input: driver.stdout! }).on('line', (line) =>
          messages.push(JSON.parse(line)),
        )
        driver.stderr?.resume()
        const wait = async (type: string, start = 0) => {
          for (let n = 0; n < 400; n++) {
            const value = messages.slice(start).find((message) => message.type === type)
            if (value) return value
            const error = messages.find((message) => message.type === 'error')
            if (error) throw new Error(error.error)
            await delay(25)
          }
          throw new Error(mode + ' driver timed out: ' + type)
        }
        const directory = (await wait('desktop-ready')).directory!
        const target = join(directory, name)
        targets.push(target)
        const rect = await row.boundingBox()
        if (!rect) throw new Error('Remote file row is not visible')
        const origin = await app.evaluate(({ BrowserWindow, screen }) => {
          const window = BrowserWindow.getAllWindows()[0]
          const bounds = window.getContentBounds()
          const scale = screen.getDisplayMatching(bounds).scaleFactor
          return { x: bounds.x, y: bounds.y, scale }
        })
        const startedBefore = await page.evaluate(
          () =>
            (window as unknown as { dragGestureState: { started: number } }).dragGestureState
              .started,
        )
        driver.stdin!.write(
          `down-at|${Math.round((origin.x + rect.x + 55) * origin.scale)}|${Math.round((origin.y + rect.y + rect.height / 2) * origin.scale)}\n`,
        )
        await wait('pressed')
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as { dragGestureState: { started: number } }).dragGestureState
                  .started,
            ),
          )
          .toBe(startedBefore + 1)
        await expect(page.locator('.transfer-row')).toHaveCount(0)
        driver.stdin!.write('outside\n')
        await wait('outside')
        driver.stdin!.write('waitoutside\n')
        await wait('tracking')
        driver.stdin!.write('release\n')
        await wait('released')
        await expect
          .poll(async () => {
            try {
              return (await readFile(folder ? join(target, 'nested', 'bytes.bin') : target)).equals(
                bytes,
              )
            } catch {
              return false
            }
          })
          .toBe(true)
        if (folder)
          await expect
            .poll(async () => {
              try {
                return await readdir(join(target, 'nested', 'empty'))
              } catch {
                return undefined
              }
            })
            .toEqual([])
        driver.stdin!.write('close\n')
        await new Promise<void>((done) => driver!.once('exit', () => done()))
        driver = undefined
      }
    } finally {
      if (driver) {
        driver.stdin?.write('cancel\nclose\n')
        await Promise.race([
          new Promise<void>((done) => driver!.once('exit', () => done())),
          delay(2000),
        ])
        driver.kill()
      }
      await allowClosing(app)
      await app.close()
      await server.close()
      for (const path of targets) {
        try {
          if ((await readFile(folder ? join(path, 'nested', 'bytes.bin') : path)).equals(bytes))
            await rm(path, { recursive: folder })
        } catch {}
      }
      await rm(data, { recursive: true, force: true })
    }
  })
