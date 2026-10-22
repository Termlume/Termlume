import { describe, it, expect } from 'vitest'
import { settingsSchema, settingsPatchSchema } from '../../src/shared/schemas'
import { COMMAND_PRESETS, macroFromPreset } from '../../src/shared/command-presets'
import {
  MacroInput,
  isCommandPrompt,
  filterMacros,
} from '../../src/renderer/src/features/terminal/MacroInput'
const macros = [{ id: 'demo', name: 'logs', command: 'journalctl -n 50', description: 'Журнал' }]
describe('terminal macros', () => {
  it('adds editable single-line examples with unique names', () => {
    const preset = COMMAND_PRESETS[0]
    const existing = [
      { ...preset, id: 'a', name: 'DISK' },
      { ...preset, id: 'b', name: 'disk-2' },
    ]
    const copy = macroFromPreset(preset, existing, 'copy')
    expect(copy.name).toBe('disk-3')
    copy.command = 'df -i'
    expect(preset.command).toBe('df -h')
    expect(settingsPatchSchema.safeParse({ macros: COMMAND_PRESETS.map((item, i) => macroFromPreset(item, [], String(i))) }).success).toBe(true)
  })
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
  it('discards a held slash query without releasing it or changing ordinary input', () => {
    const m = new MacroInput()
    m.feed('/', true)
    m.feed('logs', true)
    m.discardQuery()
    expect(m.query).toBeNull()
    expect(m.cancel()).toBe('')
    expect(m.feed('first\nsecond', true)).toBe('first\nsecond')
    m.feed('\r', true)
    m.feed('echo ', true)
    m.discardQuery()
    expect(m.feed('/', true)).toBe('/')
    expect(m.query).toBeNull()
  })
  it('keeps old macros global and scopes bound commands to their hosts', () => {
    const bound = { ...macros[0], id: 'bound', name: 'status', category: 'Диагностика', hostIds: ['host-a'] }
    expect(filterMacros([...macros, bound], '', 'host-a')).toHaveLength(2)
    expect(filterMacros([...macros, bound], '', 'host-b')).toEqual(macros)
    expect(filterMacros([...macros, bound], '')).toEqual(macros)
    expect(filterMacros([bound], 'диагностика', 'host-a')).toEqual([bound])
    expect(filterMacros([bound], 'journalctl', 'host-a')).toEqual([bound])
    const parsed = settingsPatchSchema.parse({ macros: [bound] })
    expect(parsed.macros?.[0].hostIds).toEqual(['host-a'])
    expect(parsed.macros?.[0].category).toBe('Диагностика')
    expect(settingsPatchSchema.safeParse({ macros: [{ ...bound, command: 'ls\rwhoami' }] }).success).toBe(false)
  })
})
