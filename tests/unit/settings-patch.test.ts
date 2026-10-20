import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRequest } from '../../src/main/ipc/validate'
import { settingsSchema } from '../../src/shared/schemas'
import { SettingsRepository } from '../../src/main/storage/SettingsRepository'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('validates a settings patch without materializing omitted defaults', () => {
  expect(parseRequest({ action: 'settings.update', patch: { terminalFontSize: 16 } })).toEqual({
    action: 'settings.update',
    patch: { terminalFontSize: 16 },
  })
  expect(parseRequest({ action: 'settings.update', patch: {} })).toEqual({
    action: 'settings.update',
    patch: {},
  })
})

it('preserves saved theme, interaction preferences and shortcut bindings through an IPC patch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'termlume-settings-patch-'))
  roots.push(root)
  const settings = new SettingsRepository(join(root, 'settings.json'))
  const before = await settings.update({
    themeId: 'tokyo-night',
    monitoringIntervalSeconds: 12,
    sftpMode: 'remote-only',
    shortcutBindings: { 'close-active': 'Ctrl+Shift+W' },
  })
  const request = parseRequest({ action: 'settings.update', patch: { terminalFontSize: 16 } })
  if (request.action !== 'settings.update') throw new Error('Unexpected request')
  await settings.update(request.patch)
  expect(await settings.get()).toEqual({ ...before, terminalFontSize: 16 })
})

it('monitoring interval defaults, bounds and patch persistence', async () => {
  expect(settingsSchema.parse({}).monitoringIntervalSeconds).toBe(3)
  for (const seconds of [0, 61, 1.5]) {
    expect(() =>
      parseRequest({ action: 'settings.update', patch: { monitoringIntervalSeconds: seconds } }),
    ).toThrow()
  }
  const root = await mkdtemp(join(tmpdir(), 'termlume-monitor-settings-'))
  roots.push(root)
  const path = join(root, 'settings.json')
  const repository = new SettingsRepository(path)
  await repository.update({ monitoringIntervalSeconds: 12 })
  await repository.flush()
  expect((await new SettingsRepository(path).get()).monitoringIntervalSeconds).toBe(12)
})
