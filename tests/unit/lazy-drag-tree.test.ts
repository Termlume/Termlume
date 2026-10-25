import { expect, it, vi } from 'vitest'
import { LazyDragTree } from '../../src/main/sftp/LazyDragTree'
const file = { directory: false, size: 6, modifiedAt: 1000, symlink: false }
function fixture() {
  const provider = {
    realpath: vi.fn(async (p: string) => p),
    stat: vi.fn(async (p: string) => ({ ...file, directory: p === '/remote/export' })),
    list: vi.fn(async () => [{ name: 'child.txt', ...file }]),
    read: vi.fn(async (_p: string, offset: number, size: number) =>
      Buffer.from('abcdef').subarray(offset, offset + size),
    ),
    close: vi.fn(async () => {}),
  }
  return {
    provider,
    tree: new LazyDragTree('/remote/export', { ...file, directory: true }, provider),
  }
}
it('exposes metadata and directories without fetching file contents; reads requested ranges only', async () => {
  const { tree, provider } = fixture()
  expect(await tree.stat('/')).toMatchObject({ directory: true })
  expect(await tree.list('/')).toEqual(['export'])
  expect(await tree.list('/export')).toEqual(['child.txt'])
  expect(await tree.stat('/export/child.txt')).toMatchObject({ size: 6 })
  expect(provider.read).not.toHaveBeenCalled()
  expect(await tree.read('/export/child.txt', 2, 3)).toEqual(Buffer.from('cde'))
  expect(provider.read).toHaveBeenCalledWith('/remote/export/child.txt', 2, 3)
  expect(await tree.read('/export/child.txt', 6, 50)).toHaveLength(0)
  expect(provider.read).toHaveBeenCalledTimes(1)
})
it('rejects traversal, symlinks and canonical escapes without reading content', async () => {
  const { tree, provider } = fixture()
  await expect(tree.stat('/export/../secret')).rejects.toThrow()
  await expect(tree.stat('/other')).rejects.toThrow()
  provider.stat.mockResolvedValueOnce({ ...file, symlink: true })
  await expect(tree.stat('/export/link')).rejects.toThrow()
  provider.realpath.mockResolvedValueOnce('/outside')
  await expect(tree.stat('/export/child.txt')).rejects.toThrow()
  expect(provider.read).not.toHaveBeenCalled()
})
it('propagates failed and truncated reads instead of completing with zero-filled data', async () => {
  const { tree, provider } = fixture()
  provider.read.mockResolvedValueOnce(Buffer.alloc(0))
  await expect(tree.read('/export/child.txt', 0, 6)).rejects.toThrow()
  provider.read.mockRejectedValueOnce(Error('connection lost'))
  await expect(tree.read('/export/child.txt', 0, 6)).rejects.toThrow('connection lost')
})
it('closes owned resources and stops future requests', async () => {
  const { tree, provider } = fixture()
  await tree.close()
  await tree.close()
  expect(provider.close).toHaveBeenCalledTimes(1)
  await expect(tree.read('/export/child.txt', 0, 2)).rejects.toThrow()
  expect(provider.read).not.toHaveBeenCalled()
})
