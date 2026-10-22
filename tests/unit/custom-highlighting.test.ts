import { afterEach, describe, expect, it, vi } from 'vitest'
import { HighlightEngine } from '../../src/renderer/src/features/terminal/highlight-engine'
import { AsyncOutputHighlighter } from '../../src/renderer/src/features/terminal/AsyncOutputHighlighter'
import { DEFAULT_HIGHLIGHT_RULES, type HighlightRule } from '../../src/shared/highlight-rules'
import { hostSchema, settingsPatchSchema } from '../../src/shared/schemas'

const rule: HighlightRule = {
  id: 'test',
  name: 'Test',
  mode: 'literal',
  pattern: 'test',
  color: '#112233',
  caseSensitive: false,
  wholeLine: false,
  enabled: true,
}
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '')
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('configurable highlighting', () => {
  it('matches literal metacharacters, whole lines and rule precedence without changing output', () => {
    const engine = new HighlightEngine()
    const text = 'TEST.* failed\nother'
    const result = engine.transform(text, [
      { ...rule, pattern: 'test.*', wholeLine: true },
      { ...rule, id: 'second', pattern: 'failed', color: '#ffffff' },
    ])
    expect(result).toContain('\x1b[38;2;17;34;51mTEST.* failed')
    expect(result).not.toContain('255;255;255')
    expect(strip(result)).toBe(text)
  })
  it('preserves split ANSI titles, multline OSC payloads and original terminal styles', () => {
    const engine = new HighlightEngine()
    const first = engine.transform('\x1b]0;ERROR\n', DEFAULT_HIGHLIGHT_RULES)
    expect(first).toBe('\x1b]0;ERROR\n')
    const next = engine.transform('WARNING\x07\x1b[3', DEFAULT_HIGHLIGHT_RULES)
    expect(next).toBe('WARNING\x07\x1b[3')
    expect(engine.transform('6mERROR', DEFAULT_HIGHLIGHT_RULES)).toBe(
      '6m\x1b[38;2;239;100;97mERROR\x1b[0m\x1b[36m',
    )
  })
  it('bounds zero-length matches, ignores disabled rules and leaves long lines alone', () => {
    const engine = new HighlightEngine()
    expect(engine.transform('text', [{ ...rule, mode: 'regex', pattern: '(?=.)' }])).toBe('text')
    expect(engine.transform('test', [{ ...rule, enabled: false }])).toBe('test')
    const text = 'test'.repeat(3000)
    expect(engine.transform(text, [rule])).toBe(text)
  })
  it('preserves charset escapes, complete SGR history and state while rules are disabled', () => {
    const engine = new HighlightEngine()
    expect(engine.transform('\x1b(B', [{ ...rule, pattern: 'B' }])).toBe('\x1b(B')
    engine.transform('\x1b[32m'.repeat(300), [])
    expect(strip(engine.transform('test', [rule]))).toBe('test')
    expect(engine.transform('test', [rule])).toContain('\x1b[0m\x1b[32m')
    engine.transform('\x1b]0;', [])
    expect(engine.transform('test\x07', [rule])).toBe('test\x07')
  })
  it('does not reset custom rules in an unrelated settings patch, preserves host overrides', () => {
    expect(settingsPatchSchema.parse({ terminalFontSize: 15 })).not.toHaveProperty('highlightRules')
    expect(
      hostSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Test',
        protocol: 'ssh',
        host: 'demo',
        username: 'user',
        port: 22,
        auth: 'password',
        group: '',
        favorite: false,
        color: '#ffffff',
        highlightRules: [rule],
      }).highlightRules,
    ).toEqual([rule])
  })
  it('terminates an unresponsive worker, retains every byte and acknowledges in order', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
        terminate = terminate
      },
    )
    const writes: string[] = [],
      acknowledgements: number[] = []
    const highlighter = new AsyncOutputHighlighter(
      (text, done) => {
        writes.push(text)
        done()
      },
      [rule],
    )
    const bytes = new TextEncoder().encode('Привет test')
    highlighter.write(bytes.slice(0, 1), () => acknowledgements.push(1))
    highlighter.write(bytes.slice(1), () => acknowledgements.push(2))
    await vi.advanceTimersByTimeAsync(1100)
    highlighter.write(new TextEncoder().encode(' tail'), () => acknowledgements.push(3))
    await vi.advanceTimersByTimeAsync(30)
    expect(writes.join('')).toBe('Привет test tail')
    expect(acknowledgements).toEqual([1, 2, 3])
    expect(terminate).toHaveBeenCalledOnce()
    highlighter.dispose()
  })
})
