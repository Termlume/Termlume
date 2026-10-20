import { afterEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { RemoteEditService } from '../../src/main/sftp/RemoteEditService'

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))),
)

it('pausesAndAsksBeforeUploadingWhenTheRemoteVersionChanged', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-edit-'))
  roots.push(root)
  let version = { size: 4, modifiedAt: 1 },
    fingerprint = createHash('sha256').update('edit').digest('hex')
  const prompt = vi.fn(async () => false),
    upload = vi.fn(async () => {})
  const service = new RemoteEditService({
    root,
    stat: async () => version,
    fingerprint: async () => fingerprint,
    download: async (_session, _remote, local) => fs.writeFile(local, 'edit'),
    upload,
    open: async () => '',
    confirmOverwrite: prompt,
    notify: vi.fn(),
    debounceMs: 20,
  })
  try {
    const opened = await service.open('ssh-1', '/srv/file.txt')
    fingerprint = 'different remote file contents'
    await fs.writeFile(opened.localPath, 'local edit')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    expect(upload).not.toHaveBeenCalled()
  } finally {
    await service.close()
  }
})

it('uploadsAStableLocalSaveAutomaticallyWhenTheRemoteVersionIsUnchanged', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-edit-'))
  roots.push(root)
  const version = { size: 4, modifiedAt: 1 },
    prompt = vi.fn(async () => false),
    upload = vi.fn(async () => {}),
    fingerprint = createHash('sha256').update('edit').digest('hex')
  const service = new RemoteEditService({
    root,
    stat: async () => version,
    fingerprint: async () => fingerprint,
    download: async (_session, _remote, local) => fs.writeFile(local, 'edit'),
    upload,
    open: async () => '',
    confirmOverwrite: prompt,
    notify: vi.fn(),
    debounceMs: 20,
  })
  try {
    const selectedApplication = vi.fn(async (_path: string) => '')
    const opened = await service.open('ssh-1', '/srv/file.txt', selectedApplication)
    expect(selectedApplication).toHaveBeenCalledWith(opened.localPath)
    await fs.writeFile(opened.localPath, 'updated local data')
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    expect(prompt).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalledWith('ssh-1', '/srv/file.txt', opened.localPath, version)
  } finally {
    await service.close()
  }
})

it('reportsAnUploadFailureAndPreservesTheEditedCopyForRecovery', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-edit-'))
  roots.push(root)
  const version = { size: 4, modifiedAt: 1 },
    fingerprint = createHash('sha256').update('edit').digest('hex'),
    notify = vi.fn(),
    upload = vi.fn(async () => {
      throw new Error('connection lost')
    })
  const service = new RemoteEditService({
    root,
    stat: async () => version,
    fingerprint: async () => fingerprint,
    download: async (_session, _remote, local) => fs.writeFile(local, 'edit'),
    upload,
    open: async () => '',
    confirmOverwrite: async () => false,
    notify,
    debounceMs: 20,
  })
  const opened = await service.open('ssh-1', '/srv/file.txt')
  await fs.writeFile(opened.localPath, 'unsynced data')
  await vi.waitFor(() =>
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(opened.localPath)),
  )
  await service.close()
  expect(await fs.readFile(opened.localPath, 'utf8')).toBe('unsynced data')
})
