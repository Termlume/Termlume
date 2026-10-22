import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('paste preview gates multiline writes and Ctrl+wheel zoom survives alternate-screen mouse reporting', async () => {
  test.skip(process.platform !== 'win32', 'Windows local terminal')
  const data = await mkdtemp(join(tmpdir(), 'termlume-input-guards-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PSModulePath
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click()
    const pane = page.locator('.terminal-pane.active')
    const input = pane.locator('.xterm-helper-textarea')
    await expect(pane.locator('.xterm-rows')).toContainText('PS ')
    const id = await pane.getAttribute('data-session-id')

    // Intercept only writes, after a real local terminal has connected. This
    // observes renderer-to-backend bytes without executing pasted commands.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (event: Electron.IpcMainInvokeEvent, request: unknown) => unknown
          >
        }
      )._invokeHandlers
      const original = handlers.get('terminal:request')!
      const state = globalThis as unknown as { inputGuardWrites: string[] }
      state.inputGuardWrites = []
      ipcMain.removeHandler('terminal:request')
      ipcMain.handle('terminal:request', (event, request) => {
        if (request.action === 'sessions.write') {
          state.inputGuardWrites.push(request.data)
          return { ok: true }
        }
        return original(event, request)
      })
    })
    // PowerShell enables xterm focus reporting. Moving focus into/out of the
    // preview legitimately emits ESC[O / ESC[I; neither contains pasted bytes.
    const writes = async () =>
      (
        await app.evaluate(
          () => (globalThis as unknown as { inputGuardWrites: string[] }).inputGuardWrites,
        )
      ).filter((text) => text !== '\x1b[O' && text !== '\x1b[I')
    const clearWrites = () =>
      app.evaluate(() => {
        ;(globalThis as unknown as { inputGuardWrites: string[] }).inputGuardWrites = []
      })
    const paste = async (text: string) => {
      await input.focus()
      await input.evaluate((element, value) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/plain', value)
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
        )
      }, text)
    }

    await paste('single line')
    await expect.poll(writes).toEqual(['single line'])
    await expect(page.getByRole('dialog', { name: 'Вставка нескольких строк' })).toHaveCount(0)
    await clearWrites()
    await paste('first line\nsecond line')
    const preview = page.getByRole('dialog', { name: 'Вставка нескольких строк' })
    await expect(preview).toBeVisible()
    expect(await writes()).toEqual([])
    await preview.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(preview).toHaveCount(0)
    expect(await writes()).toEqual([])

    await paste('first line\nsecond line')
    await expect(preview).toBeVisible()
    await preview.getByLabel('Текст для вставки').fill('edited first\nedited second')
    expect(await writes()).toEqual([])
    await preview.getByRole('button', { name: 'Вставить в терминал', exact: true }).click()
    await expect(preview).toHaveCount(0)
    await expect.poll(async () => (await writes()).length).toBe(1)
    expect((await writes())[0].replace(/\x1b\[20[01]~/g, '')).toBe('edited first\redited second')
    await clearWrites()

    // Simulate the control sequences used by full-screen editors (nano/vim),
    // including SGR mouse tracking. A normal wheel must reach mouse reporting;
    // Ctrl+wheel must instead be intercepted before xterm's listener.
    await app.evaluate(({ BrowserWindow }, sessionId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:event', {
        type: 'data',
        sessionId,
        sequence: 100000,
        data: Buffer.from('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J\x1b[HINPUT_GUARD_ALT_SCREEN'),
      })
    }, id)
    await expect(pane.locator('.xterm-rows')).toContainText('INPUT_GUARD_ALT_SCREEN')
    const screen = pane.locator('.xterm-screen')
    const box = (await screen.boundingBox())!
    await screen.dispatchEvent('wheel', {
      deltaY: -100,
      clientX: box.x + 20,
      clientY: box.y + 20,
      bubbles: true,
      cancelable: true,
    })
    await expect.poll(async () => (await writes()).join('')).toMatch(/\x1b\[<64;/)
    await clearWrites()
    const initial = await page.evaluate(() =>
      window.terminalApi.settings.get().then((settings) => settings.terminalFontSize),
    )
    await screen.dispatchEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: box.x + 20,
      clientY: box.y + 20,
      bubbles: true,
      cancelable: true,
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.terminalApi.settings.get().then((settings) => settings.terminalFontSize),
        ),
      )
      .toBe(initial + 1)
    expect(await writes()).toEqual([])
    await screen.dispatchEvent('wheel', {
      deltaY: 100,
      ctrlKey: true,
      clientX: box.x + 20,
      clientY: box.y + 20,
      bubbles: true,
      cancelable: true,
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.terminalApi.settings.get().then((settings) => settings.terminalFontSize),
        ),
      )
      .toBe(initial)
    expect(await writes()).toEqual([])
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
