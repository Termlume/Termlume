import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'

test('opens default WSL without a saved connection and collects live monitoring', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-wsl-default-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    const inventory = await page.evaluate(() => window.terminalApi.wsl.inventory())
    const distro = inventory.find((item) => item.isDefault)
    test.skip(!distro, 'No default WSL installed')
    expect(await page.evaluate(() => window.terminalApi.hosts.list())).toEqual([])
    await page.evaluate(async () => {
      await window.terminalApi.settings.update({ monitoringIntervalSeconds: 1 })
      window.terminalApi.monitoring.onSnapshot((event) => {
        ;(window as unknown as { wslMonitorSnapshot: typeof event.snapshot }).wslMonitorSnapshot =
          event.snapshot
      })
    })
    await page.getByRole('button', { name: `Подключиться: ${distro!.name}`, exact: true }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · WSL', {
      timeout: 20000,
    })
    await expect(page.locator('.terminal-pane.active .xterm-rows')).toContainText(/[$#>]/, {
      timeout: 10000,
    })
    await expect(page.getByText('Error: Подключение не найдено', { exact: true })).toHaveCount(0)
    await expect(page.locator('.monitoring-content')).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const snapshot = (
              window as unknown as {
                wslMonitorSnapshot?: {
                  cpuPercent: { status: string }
                  ram: { status: string }
                  disks: { status: string }
                  network: { status: string }
                }
              }
            ).wslMonitorSnapshot
            return (
              snapshot && [
                snapshot.cpuPercent.status,
                snapshot.ram.status,
                snapshot.disks.status,
                snapshot.network.status,
              ]
            )
          }),
        { timeout: 20000 },
      )
      .toEqual(['ok', 'ok', 'ok', 'ok'])
    await expect(page.locator('.terminal-pane.active .xterm-rows')).not.toContainText('__TERMINAL_')
  } finally {
    await allowClosing(app)
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
