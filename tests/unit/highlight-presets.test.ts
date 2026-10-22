import { expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_RULES,
  HIGHLIGHT_PRESETS,
  highlightRuleError,
} from '../../src/shared/highlight-rules'
import { readHighlightBuilder } from '../../src/shared/highlight-builder'
import { HighlightEngine } from '../../src/renderer/src/features/terminal/highlight-engine'

it('keeps the original three defaults and validates every optional preset', () => {
  expect(DEFAULT_HIGHLIGHT_RULES.map((rule) => rule.id)).toEqual(['error', 'warning', 'ok'])
  expect(new Set(HIGHLIGHT_PRESETS.map((preset) => preset.key)).size).toBe(HIGHLIGHT_PRESETS.length)
  for (const preset of HIGHLIGHT_PRESETS) {
    const rule = { ...preset.rule, id: preset.key }
    expect(highlightRuleError(rule), preset.key).toBeUndefined()
    expect(rule.pattern.length).toBeLessThanOrEqual(256)
    const output = new HighlightEngine().transform(preset.example, [rule])
    expect(output, preset.key).toContain('\x1b[38;2;')
    expect(output.replace(/\x1b\[[0-9;]*m/g, ''), preset.key).toBe(preset.example)
  }
})
it('keeps ordinary status presets editable as plain words and phrases', () => {
  for (const key of ['info', 'debug', 'critical', 'network', 'access']) {
    const preset = HIGHLIGHT_PRESETS.find((preset) => preset.key === key)!
    expect(readHighlightBuilder({ ...preset.rule, id: key })?.condition).toBe('words')
  }
})
it('does not color arbitrary numbers, invalid addresses or URL paths', () => {
  for (const [key, text] of [
    ['http-success', 'count 200 bytes'],
    ['http-client', '404 files processed'],
    ['ipv4', '999.1.1.1 1.2.3.999 1234.1.2.3'],
    ['unix-path', 'https://example.com/path'],
  ]) {
    const preset = HIGHLIGHT_PRESETS.find((preset) => preset.key === key)!
    expect(new HighlightEngine().transform(text, [{ ...preset.rule, id: key }])).toBe(text)
  }
})
