const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve, dirname } = require('node:path')
const { _electron } = require('@playwright/test')
async function main() {
  const latest = existsSync('latest-release.json')
    ? JSON.parse(readFileSync('latest-release.json', 'utf8')).executable
    : undefined
  const binary = resolve(
    process.env.TERMLUME_PACKAGE_BINARY || latest || 'dist/win-unpacked/Termlume.exe',
  )
  assert.ok(
    existsSync(join(dirname(binary), 'resources', 'native', 'Termlume.FileDrag.exe')),
    'Windows transfer helper is missing from the package',
  )
  assert.ok(existsSync(binary), 'Packaged executable is missing: run npm run dist:win first')
  const data = await mkdtemp(join(tmpdir(), 'terminal-package-')),
    env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const application = await _electron.launch({
    executablePath: binary,
    args: ['--user-data-dir=' + data],
    env,
  })
  try {
    const page = await application.firstWindow()
    assert.equal(await page.title(), 'Termlume')
    assert.equal(await page.evaluate(() => window.terminalApi.platform), 'win32')
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), data)
    const native = await application.evaluate(async ({ app }) => {
      const requireModule = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json')
      const resolved = requireModule.resolve('node-pty')
      if (!resolved.startsWith(app.getAppPath()))
        throw new Error('Native module resolved outside packaged application')
      const pty = requireModule('node-pty')
      return new Promise((resolve, reject) => {
        let seen = false
        const terminal = pty.spawn(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-Command',
            '[Console]::WriteLine("PACKAGED_PTY_READY"); Start-Sleep -Milliseconds 500',
          ],
          { cols: 80, rows: 24, useConptyDll: true },
        )
        const timeout = setTimeout(() => {
          terminal.kill()
          reject(new Error('Packaged PTY timed out'))
        }, 12000)
        terminal.onData((data) => {
          if (data.includes('PACKAGED_PTY_READY')) {
            seen = true
            terminal.resize(100, 30)
          }
        })
        terminal.onExit(() => {
          clearTimeout(timeout)
          resolve(seen)
        })
      })
    })
    assert.equal(native, true, 'Packaged native PTY did not produce its marker')
    const x11 = await page.evaluate(async () => {
      const available = await window.terminalApi.x11.status()
      const started = await window.terminalApi.x11.start()
      await window.terminalApi.x11.stop()
      const stopped = await window.terminalApi.x11.status()
      return { available: available.available, started: started.state, stopped: stopped.state }
    })
    assert.deepEqual(x11, { available: true, started: 'running', stopped: 'stopped' }, 'Packaged X11 runtime failed')
    assert.equal(await page.evaluate(() => window.terminalApi.logs.settings().then(config => config.auto)), false, 'Session recording should be opt-in')

    console.log(
      'PACKAGE_OK: isolated userData, renderer/preload, packaged native PTY, authenticated X11 start/stop, journal defaults, resize and teardown',
    )
  } finally {
    await application.close()
    await rm(data, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
