import * as fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WslFileAccess, wslDistribution } from '../../src/main/sftp/WslFileAccess'

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))),
)
async function fixture() {
  const base = await fs.mkdtemp(join(tmpdir(), 'termlume-wsl-'))
  roots.push(base)
  const root = join(base, 'distro'),
    outside = join(base, 'outside')
  await fs.mkdir(root)
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'x'), 'outside')
  const run = vi.fn(async (_distribution: string, args: string[]) =>
    args[0] === 'stat' ? '640\t1000\t100\talice\tusers\n' : '',
  )
  return { base, root, outside, run, files: new WslFileAccess(run, 'Test-Distro') }
}

it('lists and mutates files inside the selected distribution root', async () => {
  const { root, files } = await fixture()
  await fs.writeFile(join(root, 'hello.txt'), 'hello')
  const listing = await files.list(root, root)
  expect(listing.mode).toBe('wsl')
  expect(listing.capabilities).toMatchObject({
    list: true,
    upload: true,
    download: true,
    chmod: true,
    chown: true,
    dragOut: true,
  })
  expect(listing.entries.map((entry) => entry.name)).toContain('hello.txt')
  await files.mutate(root, { side: 'remote', path: root, operation: 'mkdir', name: 'created' })
  expect(listing.entries[0]).toMatchObject({ permissions: 0o640, owner: 'alice', group: 'users' })
  expect((await fs.stat(join(root, 'created'))).isDirectory()).toBe(true)
  await expect(files.list(root, join(root, '..', 'outside'))).rejects.toMatchObject({
    code: 'unsafe-path',
  })
})

it('uses Linux permission commands with separate arguments, preserving spaces and shell characters', async () => {
  const { root, files, run } = await fixture()
  const path = join(root, 'hello $name.txt')
  await fs.writeFile(path, 'hello')
  await files.mutate(root, { side: 'remote', path, operation: 'chmod', permissions: 0o4750 })
  expect(run).toHaveBeenLastCalledWith('Test-Distro', ['chmod', '4750', '--', '/hello $name.txt'])
  await files.mutate(root, {
    side: 'remote',
    path,
    operation: 'chown',
    owner: 'alice',
    group: 'users',
  })
  expect(run).toHaveBeenLastCalledWith('Test-Distro', [
    'chown',
    'alice:users',
    '--',
    '/hello $name.txt',
  ])
  await expect(
    files.mutate(root, {
      side: 'remote',
      path,
      operation: 'chown',
      owner: '--reference=x',
      group: 'users',
    }),
  ).rejects.toThrow()
})

it('accepts only a WSL distribution root and rejects arbitrary network shares and subfolders', () => {
  expect(wslDistribution('\\\\wsl.localhost\\Ubuntu-24.04')).toBe('Ubuntu-24.04')
  expect(wslDistribution('\\\\wsl$\\Ubuntu\\')).toBe('Ubuntu')
  for (const root of [
    'C:\\Windows',
    '\\\\server\\share',
    '\\\\wsl.localhost\\Ubuntu\\home',
    '\\\\wsl.localhost\\',
  ])
    expect(() => wslDistribution(root)).toThrow()
})

it('reports Linux command failures instead of claiming permissions changed', async () => {
  const { root, files, run } = await fixture()
  const path = join(root, 'owned-by-root')
  await fs.writeFile(path, 'file')
  run.mockRejectedValueOnce(new Error('Operation not permitted'))
  await expect(
    files.mutate(root, { side: 'remote', path, operation: 'chmod', permissions: 0o600 }),
  ).rejects.toThrow('Operation not permitted')
})

it('copies upload and download jobs through the scoped distribution adapter', async () => {
  const { base, root, files } = await fixture(),
    localRoot = join(base, 'local')
  await fs.mkdir(localRoot)
  await fs.writeFile(join(localRoot, 'upload.txt'), 'from windows')
  const progress: number[] = [],
    signal = new AbortController().signal,
    job = (direction: 'upload' | 'download', source: string, target: string) => ({
      sessionId: 'session',
      direction,
      source,
      target,
      overwrite: false,
      localRoot,
    })
  await files.transfer(
    root,
    job('upload', join(localRoot, 'upload.txt'), join(root, 'upload.txt')),
    signal,
    (done) => progress.push(done),
  )
  await files.transfer(
    root,
    job('download', join(root, 'upload.txt'), join(localRoot, 'download.txt')),
    signal,
    (done) => progress.push(done),
  )
  expect(await fs.readFile(join(localRoot, 'download.txt'), 'utf8')).toBe('from windows')
  expect(progress.at(-1)).toBeGreaterThan(0)
  await expect(
    files.transfer(
      root,
      job('download', join(root, 'upload.txt'), join(localRoot, 'download.txt')),
      signal,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'exists' })
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(
    files.transfer(
      root,
      job('download', join(root, 'upload.txt'), join(localRoot, 'cancelled.txt')),
      cancelled.signal,
      () => {},
    ),
  ).rejects.toThrow()
  await expect(fs.stat(join(localRoot, 'cancelled.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(
    files.transfer(
      root,
      job('download', join(root, '..', 'outside', 'x'), join(localRoot, 'x')),
      signal,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'unsafe-path' })
})

it('does not overwrite a local file created while a WSL download is running', async () => {
  const {root,outside,files}=await fixture()
  const source=join(root,'source.bin'),target=join(outside,'race.bin')
  await fs.writeFile(source,Buffer.alloc(256*1024,7))
  let appeared=false
  await expect(files.transfer(root,{sessionId:'test',direction:'download',source,target,overwrite:false,localRoot:outside},new AbortController().signal,done=>{
    if(done>0 && !appeared){appeared=true;writeFileSync(target,'keep this file')}
  })).rejects.toMatchObject({code:'EEXIST'})
  expect(await fs.readFile(target,'utf8')).toBe('keep this file')
})
