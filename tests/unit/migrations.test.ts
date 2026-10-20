import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateData } from '../../src/main/storage/migrations'
import { AtomicJsonStore } from '../../src/main/storage/AtomicJsonStore'
import { settingsSchema } from '../../src/shared/schemas'
import type { Settings } from '../../src/shared/contracts'

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
)
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'terminal-migrations-'))
  roots.push(path)
  return path
}

it('migrates legacy and earlier store payloads without changing data', () => {
  expect(migrateData({ themeId: 'catppuccin-mocha' }, 0, 1)).toEqual({
    themeId: 'catppuccin-mocha',
  })
  expect(migrateData({ localShell: 'cmd' }, 1, 1)).toEqual({ localShell: 'cmd' })
})

it('rejects malformed and future schemas without rewriting user data', async () => {
  const file = join(await root(), 'settings.json'),
    future = '{"schemaVersion":999,"data":{"themeId":"future"}}'
  await writeFile(file, future)
  const store = new AtomicJsonStore<Settings>(file, settingsSchema, settingsSchema.parse({}))
  await expect(store.read()).rejects.toThrow('Неподдерживаемая версия данных')
  expect(await readFile(file, 'utf8')).toBe(future)
  expect(() => migrateData({}, 20, 1)).toThrow('Неподдерживаемая версия данных')
})

it('reads old version-one files and writes explicit schemaVersion envelopes', async () => {
  const file = join(await root(), 'settings.json')
  await writeFile(file, '{"version":1,"data":{"localShell":"cmd"}}')
  const store = new AtomicJsonStore<Settings>(file, settingsSchema, settingsSchema.parse({}))
  expect((await store.read()).localShell).toBe('cmd')
  await store.write(settingsSchema.parse({ localShell: 'powershell' }))
  expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1)
})
