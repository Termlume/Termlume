import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('renderer cannot open external windows or obtain Node access', async () => {
  const data = await mkdtemp(join(tmpdir(), 'terminal-security-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    expect(
      await page.evaluate(() => ({
        require: typeof (window as any).require,
        process: typeof (window as any).process,
        ipc: typeof (window as any).ipcRenderer,
      })),
    ).toEqual({ require: 'undefined', process: 'undefined', ipc: 'undefined' })
    expect(await page.evaluate(() => window.open('https://example.com'))).toBeNull()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await app.evaluate(({ BrowserWindow }) => {
      ;(globalThis as any).navigationBlocked = false
      BrowserWindow.getAllWindows()[0].webContents.on('will-frame-navigate', (event) => {
        ;(globalThis as any).navigationBlocked = event.defaultPrevented
      })
    })
    await page.evaluate(() => {
      window.location.href = 'https://example.com'
    })
    await expect.poll(() => app.evaluate(() => (globalThis as any).navigationBlocked)).toBe(true)
    const state = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      return { url: contents.getURL(), title: contents.getTitle() }
    })
    expect(state.url).toMatch(/^file:.*out\/renderer\/index.html$/)
    expect(state.title).toBe('Termlume')
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
