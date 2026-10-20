import { it, expect } from 'vitest'
import { mkdtemp, mkdir, symlink, rm, realpath, writeFile, readFile, lstat } from 'node:fs/promises'
import { LocalFilesService } from '../../src/main/sftp/LocalFilesService'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeDownloadTarget } from '../../src/main/sftp/local-paths'
it('downloadTargetRejectsTraversalAndSymlinkEscape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-paths-'))
  try {
    const inside = join(root, 'inside'),
      outside = join(root, 'outside')
    await mkdir(inside)
    await mkdir(outside)
    for (const name of [
      '../escape',
      '..',
      'C:\\secret',
      'file:stream',
      'CON',
      'bad.',
      'a/b',
      'a\\b',
    ])
      await expect(safeDownloadTarget(inside, inside, name)).rejects.toThrow()
    await symlink(outside, join(inside, 'link'), 'junction')
    await expect(safeDownloadTarget(inside, join(inside, 'link'), 'safe.txt')).rejects.toThrow()
    expect(await safeDownloadTarget(inside, inside, 'Отчёт 2026.txt')).toBe(
      join(await realpath(inside), 'Отчёт 2026.txt'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('removingLocalSymlinkLeavesItsTargetIntact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-link-'))
  try {
    const target = join(root, 'target')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'keep')
    await symlink(target, join(root, 'link'), 'junction')
    const service = new LocalFilesService(root)
    await service.remove(join(root, 'link'), 'file')
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await lstat(join(root, 'link')).catch(() => undefined)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('opensOnlyCompletedRegularFilesInsideTheTransferRoot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-open-completed-'))
  try {
    const file = join(root, 'report.txt')
    await writeFile(file, 'report')
    const service = new LocalFilesService(root)
    const opened: string[] = []
    await expect(
      service.openCompleted(file, root, async (path) => void opened.push(path)),
    ).resolves.toBeUndefined()
    expect(opened).toEqual([await realpath(file)])
    await expect(
      service.openCompleted(join(root, '..', 'outside.txt'), root, async () => {}),
    ).rejects.toThrow()
    await expect(service.openCompleted(root, root, async () => {})).rejects.toThrow()
    await expect(
      service.openCompleted(file, root, async () => 'No application is associated with this file'),
    ).rejects.toThrow('No application is associated with this file')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('validatesDroppedFilesAgainstTheChosenRootAndRejectsLinksAndDirectories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-dropped-files-'))
  try {
    const nested = join(root, 'nested'),
      outside = await mkdtemp(join(tmpdir(), 'terminal-dropped-outside-'))
    await mkdir(nested)
    const file = join(nested, 'config.txt'),
      folder = join(nested, 'folder')
    await writeFile(file, 'config')
    await mkdir(folder)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(nested, 'linked-dir'), 'junction')
    const service = new LocalFilesService(root)
    expect(await service.validateDroppedFile(file)).toBe(await realpath(file))
    await expect(service.validateDroppedFile(folder)).rejects.toThrow('обычные файлы')
    await expect(service.validateDroppedFile(join(nested, 'linked-dir'))).rejects.toThrow(
      'обычные файлы',
    )
    await expect(service.validateDroppedFile(join(outside, 'secret.txt'))).rejects.toThrow()
    await rm(outside, { recursive: true, force: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('explicitExternalDropAllowsFilesOutsideThePaneAndKeepsPerFileSourceRoots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-external-drop-'))
  try {
    const pane = join(root, 'pane'),
      desktop = join(root, 'desktop')
    await mkdir(pane)
    await mkdir(desktop)
    const file = join(desktop, 'upload.txt'),
      link = join(desktop, 'linked-folder')
    await writeFile(file, 'desktop file')
    await symlink(pane, link, 'junction')
    const service = new LocalFilesService(pane)
    await expect(service.validateDroppedFile(file)).rejects.toThrow()
    expect(await service.validateExternalDroppedFile(file)).toEqual({
      source: await realpath(file),
      localRoot: await realpath(desktop),
    })
    await expect(service.validateExternalDroppedFile(link)).rejects.toThrow('обычные файлы')
    await expect(service.validateExternalDroppedFile('relative.txt')).rejects.toThrow()
    expect(service.root).toBe(pane)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
