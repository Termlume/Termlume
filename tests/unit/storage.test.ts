import { it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonStore } from '../../src/main/storage/AtomicJsonStore'
import { SettingsRepository } from '../../src/main/storage/SettingsRepository'
import { settingsSchema } from '../../src/shared/schemas'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'terminal-store-'))
  roots.push(root)
  return join(root, 'catalog.json')
}
it('failedRenameKeepsPreviousCatalog', async () => {
  const file = await fixture(),
    schema = z.array(z.string())
  await new AtomicJsonStore(file, schema, []).write(['saved'])
  const store = new AtomicJsonStore(file, schema, [], {
    ...fs,
    rename: async () => {
      throw new Error('locked')
    },
  })
  await expect(store.write(['new'])).rejects.toThrow('locked')
  expect(await new AtomicJsonStore(file, schema, []).read()).toEqual(['saved'])
})
it('corruptPrimaryOffersBackupWithoutOverwriting', async () => {
  const file = await fixture()
  const store = new AtomicJsonStore(file, z.array(z.string()), [])
  await store.write(['first'])
  await store.write(['second'])
  await writeFile(file, 'BROKEN')
  const restored = new AtomicJsonStore(file, z.array(z.string()), [])
  expect(await restored.read()).toEqual(['first'])
  expect(restored.warning).toBeTruthy()
  expect(await readFile(file, 'utf8')).toBe('BROKEN')
})
it('concurrentUpdatesDoNotLoseChanges', async () => {
  const store = new AtomicJsonStore(await fixture(), z.array(z.string()), [])
  await Promise.all(
    ['one', 'two', 'three'].map((value) => store.update((items) => [...items, value])),
  )
  expect(await store.read()).toEqual(['one', 'two', 'three'])
})
it('legacySettingsReceiveInteractionDefaults', async () => {
  const settings = new SettingsRepository(await fixture())
  await expect(settings.get()).resolves.toMatchObject({
    sftpMode: 'remote-only',
    mouseAction: 'select-copy-right-paste',
    localShell: 'powershell',
    smoothInput: false,
  })
})
it('settingsUpdatesValidateAndPersistInteractionPreferences', async () => {
  const settings = new SettingsRepository(await fixture())
  const updated = await settings.update({
    sftpMode: 'remote-only',
    mouseAction: 'manual',
    localShell: 'cmd',
    smoothInput: true,
  })
  expect(await settings.get()).toEqual(updated)
  expect(() => settingsSchema.parse({ sftpMode: 'other' })).toThrow()
})
