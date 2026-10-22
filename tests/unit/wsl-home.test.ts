import { expect, it, vi } from 'vitest'
import { wslHomeDirectory } from '../../src/main/platform/wsl-home'

const root = '\\\\wsl.localhost\\Ubuntu'
it('maps the queried actual Linux HOME into its selected distribution root', async () => {
  const run = vi.fn(async () => '/home/alice')
  expect(await wslHomeDirectory('Ubuntu', root, run)).toBe(root + '\\home\\alice')
  expect(run).toHaveBeenCalledWith('Ubuntu')
  expect(await wslHomeDirectory('Ubuntu', root, async () => '/home/Alice Smith/')).toBe(
    root + '\\home\\Alice Smith',
  )
  expect(await wslHomeDirectory('Ubuntu', root, async () => '/')).toBe(root)
})
it.each([
  'relative',
  '/home/../outside',
  '/home/./alice',
  '/bad\npath',
  '/bad\0path',
  '/bad\\path',
  '/bad:path',
  '/' + 'a'.repeat(4096),
])('falls back safely for invalid HOME %j', async (home) => {
  expect(await wslHomeDirectory('Ubuntu', root, async () => home)).toBe(root)
})
it('keeps the existing root when the bounded query is unavailable', async () => {
  expect(
    await wslHomeDirectory('Ubuntu', root, async () => {
      throw new Error('timeout')
    }),
  ).toBe(root)
  const run = vi.fn(async () => '/home/alice')
  expect(await wslHomeDirectory('Debian', root, run)).toBe(root)
  expect(run).not.toHaveBeenCalled()
})
