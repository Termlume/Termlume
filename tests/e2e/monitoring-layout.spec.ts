import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowClosing } from './helpers'
import { sshFixture } from '../integration/fixtures/ssh-server'

test('sidebar monitoring graphs stay visible when scrolled and compact temperature uses an icon', async () => {
  const data = await mkdtemp(join(tmpdir(), 'termlume-monitor-layout-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const server = await sshFixture()
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + data], env })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1000, height: 650 })
    // Keep the real SSH/UI connection, with deterministic synthetic metrics so
    // this layout check does not wait for the monitor's sampling interval.
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
      ipcMain.removeHandler('terminal:request')
      ipcMain.handle('terminal:request', (event, request) =>
        request.action === 'monitoring.setVisible' ? { ok: true } : original(event, request),
      )
    })
    await page.evaluate(async (port) => {
      const id = crypto.randomUUID()
      await window.terminalApi.settings.update({ monitoringPlacement: 'sidebar' })
      await window.terminalApi.hosts.save({
        id,
        name: 'Monitoring layout fixture',
        protocol: 'ssh',
        host: '127.0.0.1',
        port,
        username: 'user',
        auth: 'password',
        group: 'Tests',
        favorite: true,
        monitoringEnabled: true,
        monitoringItems: [
          'host',
          'cpu',
          'ram',
          'network-upload',
          'network-download',
          'temperatures',
        ],
      })
      await window.terminalApi.hosts.setSecret(id, 'test-password')
    }, server.port)
    await page.reload()
    await page.getByRole('button', { name: 'Подключиться: Monitoring layout fixture' }).click()
    await page.getByRole('button', { name: 'Доверять и подключиться' }).click()
    await expect(page.getByRole('contentinfo')).toContainText('Подключено · SSH')
    const sessionId = await page.locator('.terminal-pane.active').getAttribute('data-session-id')
    const publishSnapshot = () =>
      app.evaluate(({ BrowserWindow }, id) => {
        const sampledAt = Date.now()
        const ok = <T>(value: T) => ({ status: 'ok', value, sampledAt })
        BrowserWindow.getAllWindows()[0].webContents.send('terminal:metric', {
          sessionId: id,
          snapshot: {
            sampledAt,
            state: 'sampling',
            cpuPercent: ok(31),
            ram: ok({ total: 1024 ** 3, used: 512 * 1024 ** 2, available: 512 * 1024 ** 2 }),
            swap: ok({ total: 0, used: 0, available: 0 }),
            disks: ok([]),
            uptime: ok(3600),
            network: ok({ rx: 1024, tx: 2048, interfaces: [{ name: 'eth0', rx: 1024, tx: 2048 }] }),
            temperatures: ok([{ id: 'cpu', label: 'CPU package', celsius: 52.5 }]),
            system: ok({ hostname: 'layout-fixture' }),
            history: Array.from({ length: 20 }, (_, index) => ({
              sampledAt: sampledAt - (20 - index) * 3000,
              cpuPercent: 10 + index,
              ramPercent: 50,
              rx: index * 100,
              tx: index * 200,
            })),
          },
        })
      }, sessionId)
    await publishSnapshot()
    const content = page.locator('.aux-panel > .monitoring-content')
    const expanded = content.locator('.monitoring-bar.monitoring-expanded')
    await expect(expanded).toBeVisible()
    await expect(content.getByText('52.5°C', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Настроить показатели', exact: true }),
    ).toHaveCount(0)
    const layout = await expanded.evaluate((element) => {
      const css = getComputedStyle(element)
      return {
        height: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowX: css.overflowX,
        overflowY: css.overflowY,
        direction: css.flexDirection,
      }
    })
    expect(layout.direction).toBe('column')
    expect(layout.height).toBeGreaterThan(200)
    expect(layout.overflowX).toBe('visible')
    expect(layout.overflowY).toBe('visible')
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1)
    const charts = content.locator('.history-chart')
    await expect(charts).toHaveCount(3)
    for (const chart of await charts.all()) {
      await chart.scrollIntoViewIfNeeded()
      const bounds = await chart.evaluate((element) => {
        const graph = element.getBoundingClientRect()
        const scroller = element.closest('.monitoring-content')!.getBoundingClientRect()
        const card = element.closest('.metric-card')!.getBoundingClientRect()
        return {
          graph: {
            left: graph.left,
            right: graph.right,
            top: graph.top,
            bottom: graph.bottom,
            height: graph.height,
          },
          scroller: {
            left: scroller.left,
            right: scroller.right,
            top: scroller.top,
            bottom: scroller.bottom,
          },
          card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        }
      })
      expect(bounds.graph.height).toBeGreaterThan(30)
      for (const container of [bounds.scroller, bounds.card]) {
        expect(bounds.graph.left).toBeGreaterThanOrEqual(container.left - 1)
        expect(bounds.graph.right).toBeLessThanOrEqual(container.right + 1)
        expect(bounds.graph.top).toBeGreaterThanOrEqual(container.top - 1)
        expect(bounds.graph.bottom).toBeLessThanOrEqual(container.bottom + 1)
      }
    }
    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('tab', { name: 'Мониторинг', exact: true }).click()
    await page
      .getByLabel(/Расположение мониторинга/)
      .selectOption('under-terminal')
    await page.getByRole('button', { name: 'Применить', exact: true }).click()
    await expect(page.locator('.monitoring-bottom')).toBeVisible()
    await publishSnapshot()
    const temperature = page
      .locator('.monitoring-bottom')
      .getByRole('button', { name: /^Температуры:/ })
    await expect(temperature).toContainText('52.5°C')
    await expect(temperature.locator('svg')).toHaveCount(1)
    expect(await temperature.innerText()).not.toContain('Температуры')
    await expect(
      page.getByRole('button', { name: 'Настроить показатели', exact: true }),
    ).toHaveCount(0)
  } finally {
    await allowClosing(app)
    await app.close()
    await server.close()
    await rm(data, { recursive: true, force: true })
  }
})
