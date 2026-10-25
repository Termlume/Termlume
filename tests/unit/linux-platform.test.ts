import { describe, expect, it } from 'vitest'
import { localShellCommand } from '../../src/main/sessions/LocalShellAdapter'
import { validateFileName } from '../../src/main/sftp/local-paths'
import { systemDisplay } from '../../src/main/x11/SystemX11Server'
import { resolveUserDataPath } from '../../src/main/storage/user-data-path'
import { join } from 'node:path'
import { TerminalCwdTracker } from '../../src/main/sessions/TerminalCwdTracker'

describe('Linux platform boundaries', () => {
  it('uses a Linux config directory without changing legacy Windows storage', () => {
    expect(resolveUserDataPath('/config', undefined, 'linux')).toBe(join('/config', 'Termlume'))
    expect(resolveUserDataPath('/config', undefined, 'win32')).toBe(join('/config', 'Terminal'))
  })
  it('uses an absolute login shell and normalizes imported Windows choices', () => {
    expect(localShellCommand('system', '', 'linux', { SHELL: '/usr/bin/zsh' })).toEqual({
      executable: '/usr/bin/zsh',
      args: ['-l'],
    })
    expect(localShellCommand('powershell', '', 'linux', { SHELL: 'bash; unsafe' }).executable).toBe(
      '/bin/bash',
    )
    expect(localShellCommand('bash', '', 'linux', { SHELL: '/bin/zsh' }).executable).toBe(
      '/bin/bash',
    )
  })
  it('accepts POSIX names while preserving Windows restrictions', () => {
    for (const name of ['CON', 'report:2026', 'trailing.', 'trailing ']) {
      expect(validateFileName(name, 'linux')).toBe(name)
      expect(() => validateFileName(name, 'win32')).toThrow()
    }
    for (const name of ['../file', '..', 'a\u0000b'])
      expect(() => validateFileName(name, 'linux')).toThrow()
  })
  it('routes local displays to Unix sockets without accepting arbitrary remote displays', () => {
    expect(systemDisplay(':0')).toEqual({ port: 6000, socketPath: '/tmp/.X11-unix/X0' })
    expect(systemDisplay('unix:12.0').socketPath).toBe('/tmp/.X11-unix/X12')
    expect(systemDisplay('localhost:10.0')).toEqual({ port: 6010 })
    expect(() => systemDisplay('remote.example:0')).toThrow()
  })
  it('tracks POSIX OSC7 for a local Linux shell', () => {
    const paths: string[] = []
    const tracker = new TerminalCwdTracker(
      { protocol: 'local', shell: 'bash', name: 'Bash' },
      (path) => paths.push(path),
    )
    tracker.feed(Buffer.from('\x1b]7;file:///home/demo/project\x07'))
    expect(paths).toEqual(['/home/demo/project'])
    tracker.close()
  })
})
