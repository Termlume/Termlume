import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnownHostsRepository } from '../../src/main/storage/KnownHostsRepository'
it('hostAndPortIdentifyKnownKey', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-known-'))
  try {
    const repo = new KnownHostsRepository(join(root, 'known.json')),
      key = Buffer.from('public-key')
    expect(await repo.check('SERVER', 22, key)).toBe('new')
    await repo.trust('server', 22, key)
    expect(await repo.check('SERVER', 22, key)).toBe('match')
    expect(await repo.check('server', 23, key)).toBe('new')
    expect(await repo.check('server', 22, Buffer.from('changed'))).toBe('changed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
