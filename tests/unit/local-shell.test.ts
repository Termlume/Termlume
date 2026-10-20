import { describe, expect, it, vi } from 'vitest'
import { LocalShellAdapter, localShellCommand } from '../../src/main/sessions/LocalShellAdapter'

describe('LocalShellAdapter', () => {
  it('selects PowerShell and cmd using fixed executable and argument arrays', () => {
    expect(localShellCommand('powershell', 'C:\\Windows')).toEqual({
      executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoLogo', '-NoExit'],
    })
    expect(localShellCommand('cmd', 'C:\\Windows')).toEqual({
      executable: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/Q', '/K'],
    })
  })

  it('forwards input, resize and output and closes the owned PTY once', async () => {
    const handlers: { data?: (value: string) => void; exit?: () => void } = {},
      pty = {
        onData: (fn: (value: string) => void) => {
          handlers.data = fn
          return { dispose() {} }
        },
        onExit: (fn: () => void) => {
          handlers.exit = fn
          return { dispose() {} }
        },
        write: vi.fn(),
        resize: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        kill: vi.fn(),
      }
    const spawn = vi.fn(() => pty as never),
      adapter = new LocalShellAdapter('cmd', spawn as never),
      events: unknown[] = []
    adapter.subscribe((event) => events.push(event))
    const connecting = adapter.connect(new AbortController().signal)
    adapter.write('queued before initial output')
    handlers.data?.('startup')
    await connecting
    adapter.write('echo hi\r')
    adapter.resize(120, 40)
    handlers.data?.('hello')
    expect(spawn).toHaveBeenCalledWith(
      localShellCommand('cmd').executable,
      ['/Q', '/K'],
      expect.objectContaining({ cols: 80, rows: 24 }),
    )
    expect(pty.write).toHaveBeenCalledWith('echo hi\r')
    expect(pty.write).toHaveBeenCalledWith('queued before initial output')
    expect(pty.resize).toHaveBeenCalledWith(120, 40)
    expect(events).toContainEqual(expect.objectContaining({ type: 'data' }))
    await adapter.close()
    await adapter.close()
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  it('reports natural process exit', async () => {
    const handlers: { exit?: () => void } = {},
      pty = {
        onData: () => ({ dispose() {} }),
        onExit: (fn: () => void) => {
          handlers.exit = fn
          return { dispose() {} }
        },
        write() {},
        resize() {},
        pause() {},
        resume() {},
        kill() {},
      }
    const adapter = new LocalShellAdapter('powershell', (() => pty as never) as never),
      events: unknown[] = []
    adapter.subscribe((event) => events.push(event))
    const connecting = adapter.connect(new AbortController().signal)
    handlers.exit?.()
    await connecting
    expect(events).toContainEqual({ type: 'closed', reason: 'remote-exit' })
  })
})
