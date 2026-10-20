import { describe, it, expect } from 'vitest'
import { settingsSchema, settingsPatchSchema } from '../../src/shared/schemas'
import {
  MacroInput,
  isCommandPrompt,
  filterMacros,
} from '../../src/renderer/src/features/terminal/MacroInput'
const macros = [{ id: 'demo', name: 'logs', command: 'journalctl -n 50', description: 'Журнал' }]
describe('terminal macros', () => {
  it('ignores terminal capability and focus replies while tracking command input', () => {
    const m = new MacroInput()
    expect(m.feed('\x1b[?1;2c', false)).toBe('\x1b[?1;2c')
    m.feed('\x1b[I', true)
    expect(m.feed('/', true)).toBe('')
    m.feed('\x1b[O', true)
    expect(m.query).toBe('')
  })
  it('migrates old settings and leaves unrelated patches alone', () => {
    expect(settingsSchema.parse({}).macros).toEqual([])
    expect(settingsPatchSchema.parse({ themeId: 'catppuccin-latte' })).not.toHaveProperty('macros')
    expect(settingsPatchSchema.safeParse({ macros }).success).toBe(true)
    expect(
      settingsPatchSchema.safeParse({
        macros: [...macros, { ...macros[0], id: 'other', name: 'LOGS' }],
      }).success,
    ).toBe(false)
    expect(
      settingsPatchSchema.safeParse({ macros: [{ ...macros[0], command: 'ls\nrm -r /tmp/demo' }] })
        .success,
    ).toBe(false)
  })
  it('only recognizes shell prompts, not passwords or command output', () => {
    for (const prompt of ['demo@server:~$ ', 'PS C:\\Users\\demo> ', 'router#', 'C:\\>'])
      expect(isCommandPrompt(prompt)).toBe(true)
    for (const text of ['Password: ', '$ echo ', 'loading...', ''])
      expect(isCommandPrompt(text)).toBe(false)
  })
  it('holds slash input, inserts a macro without executing, then forwards Enter', () => {
    const m = new MacroInput()
    expect(m.feed('/', true)).toBe('')
    expect(m.feed('lo', true)).toBe('')
    expect(m.query).toBe('lo')
    expect(m.choose(macros[0])).toBe('journalctl -n 50')
    expect(m.query).toBeNull()
    expect(m.feed('\r', true)).toBe('\r')
  })
  it('preserves paths, cancels on Escape and passes paste through', () => {
    const m = new MacroInput()
    m.feed('/', true)
    m.feed('usr', true)
    expect(m.cancel()).toBe('/usr')
    expect(m.feed('/etc/hosts', true)).toBe('/etc/hosts')
    m.feed('\r', true)
    m.feed('/', true)
    m.feed('lo', true)
    expect(m.feed('\x7f', true)).toBe('')
    expect(m.query).toBe('l')
    expect(m.feed('\x15', true)).toBe('')
    expect(m.query).toBeNull()
  })
  it('does not intercept after another character or history navigation', () => {
    const m = new MacroInput()
    m.feed('echo ', true)
    expect(m.feed('/', true)).toBe('/')
    m.feed('\r', true)
    m.feed('\x1b[A', true)
    expect(m.feed('/', true)).toBe('/')
  })
  it('filters by name and description', () => {
    expect(filterMacros(macros, 'Журнал')).toEqual(macros)
    expect(filterMacros(macros, 'unknown')).toEqual([])
  })
})
