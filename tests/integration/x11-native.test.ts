import { expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { X11Server } from '../../src/main/x11/X11Server'
import { xauthority } from '../../src/main/x11/auth'

it.skipIf(process.platform !== 'win32' || !existsSync(join(process.cwd(), 'build/x11/vcxsrv.exe')))(
  'starts the real managed VcXsrv with cookie authentication and shuts it down',
  async () => {
    const server = new X11Server(join(process.cwd(), 'build/x11/vcxsrv.exe'))
    try {
      const lease = await server.acquire(true, false)
      expect(lease.endpoint.cookie).toHaveLength(16)
      expect((await server.status()).state).toBe('running')
      await expect(server.stop()).rejects.toThrow(/SSH/)
      lease.release()
      await server.stop()
      expect((await server.status()).state).toBe('stopped')
    } finally {
      await server.close()
    }
  },
  20000,
)

it.skipIf(process.platform !== 'win32' || !existsSync(join(process.cwd(), 'build/x11/xclock.exe')))(
  'maps a native X11 application window and queries it through authenticated X11',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termlume-x11-test-'))
    const server = new X11Server(join(process.cwd(), 'build/x11/vcxsrv.exe'))
    let clock: ReturnType<typeof spawn> | undefined
    try {
      const lease = await server.acquire(true, false)
      const auth = join(directory, 'Xauthority')
      const display = `127.0.0.1:${lease.endpoint.port - 6000}.0`
      await writeFile(auth, xauthority(lease.endpoint.cookie, lease.endpoint.port - 6000))
      const options = {
        cwd: join(process.cwd(), 'build/x11'),
        env: { ...process.env, DISPLAY: display, XAUTHORITY: auth },
        windowsHide: true,
      }
      clock = spawn(
        join(options.cwd, 'xclock.exe'),
        ['-name', 'Termlume-X11-verification'],
        options,
      )
      let tree = ''
      for (let attempt = 0; attempt < 20; attempt++) {
        tree = (
          await promisify(execFile)(join(options.cwd, 'xwininfo.exe'), ['-root', '-tree'], options)
        ).stdout
        if (tree.includes('Termlume-X11-verification')) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(tree).toContain('Termlume-X11-verification')
      lease.release()
    } finally {
      clock?.kill()
      await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  20000,
)
