import { describe, expect, it } from 'vitest'
import { localShellOptions, normalizeLocalShell } from '../../src/shared/local-shells'

describe('platform local shells', () => {
  it('normalizes imported Windows settings to the Linux system shell', () => {
    expect(normalizeLocalShell('powershell', 'linux')).toBe('system')
    expect(normalizeLocalShell('cmd', 'linux')).toBe('system')
    expect(normalizeLocalShell(undefined, 'linux')).toBe('system')
    expect(localShellOptions('linux')).toEqual(['system', 'bash', 'zsh'])
    expect(normalizeLocalShell('zsh', 'linux')).toBe('zsh')
  })
  it('preserves Windows shell choices and defaults', () => {
    expect(normalizeLocalShell('cmd', 'win32')).toBe('cmd')
    expect(normalizeLocalShell('bash', 'win32')).toBe('powershell')
    expect(normalizeLocalShell(undefined, 'win32')).toBe('powershell')
    expect(localShellOptions('win32')).toEqual(['powershell', 'cmd'])
  })
})
