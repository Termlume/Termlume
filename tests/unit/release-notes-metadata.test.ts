import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const prepare = createRequire(import.meta.url)('../../scripts/prepare-update-metadata.cjs')
it('publishes version-specific whats-new inside all updater manifests', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'termlume-manifest-'))
  try {
    await writeFile(join(folder, 'alpha.yml'), 'version: 0.1.0-alpha.3\nfiles: []\n')
    prepare(folder, '0.1.0-alpha.3')
    const alpha = await readFile(join(folder, 'alpha.yml'), 'utf8')
    expect(alpha).toContain('releaseNotes: |')
    expect(alpha).toContain('Самостоятельные вкладки SFTP')
    expect(alpha).not.toContain('Автоматическая проверка обновлений каждый час')
    expect(await readFile(join(folder, 'beta.yml'), 'utf8')).toBe(alpha)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
