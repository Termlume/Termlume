import { afterEach, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFilesService } from '../../src/main/sftp/LocalFilesService'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
it('renames into the destination directory, preserves content and refuses replacement or descendants', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-move-'))
  roots.push(root)
  const service = new LocalFilesService(root)
  await fs.mkdir(join(root, 'folder'))
  await fs.mkdir(join(root, 'folder', 'child'))
  await fs.writeFile(join(root, 'source'), 'original')
  await service.move(join(root, 'source'), join(root, 'folder'))
  expect(await fs.readFile(join(root, 'folder', 'source'), 'utf8')).toBe('original')
  await expect(fs.stat(join(root, 'source'))).rejects.toThrow()
  await fs.writeFile(join(root, 'source'), 'keep')
  await expect(service.move(join(root, 'source'), join(root, 'folder'))).rejects.toMatchObject({
    code: 'exists',
  })
  expect(await fs.readFile(join(root, 'source'), 'utf8')).toBe('keep')
  await expect(
    service.move(join(root, 'folder'), join(root, 'folder', 'child')),
  ).rejects.toMatchObject({ code: 'move-descendant' })
})
