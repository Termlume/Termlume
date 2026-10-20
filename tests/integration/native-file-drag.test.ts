import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { WindowsDropTransfer } from '../../src/main/sftp/WindowsDropTransfer'

describe.skipIf(process.platform !== 'win32')('Windows OLE file transfer', () => {
  it('prestarts and shuts down without transferring content', async () => {
    const tracker = new WindowsDropTransfer(
      resolve('native/windows-drag/bin/Termlume.FileDrag.exe'),
    )
    await tracker.ready()
    let requested = false
    expect(
      await tracker.drag({ name: 'cancelled.txt' }, async () => {
        requested = true
        throw new Error('Cancelled gestures must not download')
      }),
    ).toBe(false)
    expect(requested).toBe(false)
    await tracker.close()
    await expect(tracker.ready()).rejects.toThrow('остановлен')
  })
})
