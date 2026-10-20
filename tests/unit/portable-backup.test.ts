import { expect, it } from 'vitest'
import {
  decodePortableBackup,
  encodePortableBackup,
  type PortableData,
} from '../../src/main/storage/portable-backup'
import { settingsSchema } from '../../src/shared/schemas'
import { DataImportTransaction } from '../../src/main/storage/DataImportTransaction'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sample: PortableData = {
  hosts: [],
  identities: [],
  settings: {
    themeId: 'catppuccin-mocha',
    terminalFont: 'Consolas',
    terminalFontSize: 14,
    sidebarWidth: 260,
    monitorWidth: 280,
    sftpHeight: 300,
    windowBounds: { width: 1440, height: 900 },
    sftpMode: 'two-panel',
    mouseAction: 'select-copy-right-paste',
    localShell: 'powershell',
    smoothInput: false,
  },
  knownHosts: {},
  secrets: { 'secret-ref': 'private-password' },
}

it('round-trips secrets through authenticated encryption and rejects wrong or tampered archives', async () => {
  const archive = await encodePortableBackup(sample, 'correct horse battery staple')
  expect(await decodePortableBackup(archive, 'correct horse battery staple')).toEqual({
    ...sample,
    settings: settingsSchema.parse(sample.settings),
  })
  await expect(decodePortableBackup(archive, 'wrong password')).rejects.toThrow()
  const tampered = Buffer.from(archive),
    index = tampered.length - 5
  tampered[index] = tampered[index] === 65 ? 66 : 65
  await expect(decodePortableBackup(tampered, 'correct horse battery staple')).rejects.toThrow()
  await expect(
    decodePortableBackup(archive.subarray(0, 30), 'correct horse battery staple'),
  ).rejects.toThrow()
})

it('rejects invalid payload schemas and duplicate IDs before import', async () => {
  const invalid = { ...sample, settings: { ...sample.settings, terminalFontSize: 900 } }
  await expect(
    encodePortableBackup(invalid as PortableData, 'correct horse battery staple'),
  ).rejects.toThrow()
  const host = {
    id: '4f462e70-7dd6-46f5-9ea9-4928fb734654',
    name: 'router',
    protocol: 'ssh',
    host: 'router.local',
    port: 22,
    username: 'admin',
    auth: 'password',
    favorite: true,
    group: '',
    monitoringEnabled: true,
  }
  await expect(
    encodePortableBackup(
      { ...sample, hosts: [host, host] } as PortableData,
      'correct horse battery staple',
    ),
  ).rejects.toThrow()
  await expect(
    encodePortableBackup(
      { ...sample, privateKeyBytes: 'PRIVATE KEY' } as unknown as PortableData,
      'correct horse battery staple',
    ),
  ).rejects.toThrow()
})

it('recovers interrupted repository swaps to the complete previous snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-import-')),
    first = join(root, 'hosts.json'),
    second = join(root, 'settings.json')
  try {
    await writeFile(first, 'old-hosts')
    await writeFile(second, 'old-settings')
    const transaction = new DataImportTransaction(root)
    await transaction.prepare(
      new Map([
        [first, 'new-hosts'],
        [second, 'new-settings'],
      ]),
    )
    // Simulate a crash after the first atomic replacement and before the next one.
    await writeFile(first, 'new-hosts')
    await DataImportTransaction.recover(root)
    expect(await readFile(first, 'utf8')).toBe('old-hosts')
    expect(await readFile(second, 'utf8')).toBe('old-settings')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('cleans a prepared but not-yet-swapped import without changing existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-import-before-swap-')),
    file = join(root, 'hosts.json')
  try {
    await writeFile(file, 'previous')
    await new DataImportTransaction(root).prepare(new Map([[file, 'replacement']]))
    await DataImportTransaction.recover(root)
    expect(await readFile(file, 'utf8')).toBe('previous')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses to recover through a symlinked parent outside the data folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-import-link-')),
    outside = await mkdtemp(join(tmpdir(), 'terminal-import-outside-')),
    parent = join(root, 'nested'),
    file = join(parent, 'hosts.json'),
    outsideFile = join(outside, 'hosts.json')
  try {
    await mkdir(parent)
    await writeFile(file, 'previous')
    await writeFile(outsideFile, 'outside')
    await new DataImportTransaction(root).prepare(new Map([[file, 'replacement']]))
    await rm(parent, { recursive: true })
    await symlink(outside, parent, 'junction')

    await expect(DataImportTransaction.recover(root)).rejects.toThrow()
    expect(await readFile(outsideFile, 'utf8')).toBe('outside')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
