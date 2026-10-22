import { describe, expect, it } from 'vitest'
import {
  buildHighlightPattern,
  readHighlightBuilder,
  type HighlightCondition,
} from '../../src/shared/highlight-builder'
import { DEFAULT_HIGHLIGHT_RULES } from '../../src/shared/highlight-rules'
const rule = DEFAULT_HIGHLIGHT_RULES[0]
describe('plain-language highlighting constructor', () => {
  it.each(['contains', 'words', 'starts', 'ends'] as HighlightCondition[])(
    'round-trips escaped phrases for %s',
    (condition) => {
      const builder = { text: 'ERROR\nошибка подключения\na.b (x)|[y]\\z+$?', condition }
      const pattern = buildHighlightPattern(builder)
      expect(readHighlightBuilder({ ...rule, mode: 'regex', pattern })).toEqual(builder)
      expect(new RegExp(pattern).test('a.b (x)|[y]\\z+$?')).toBe(true)
      expect(new RegExp(pattern).test('axb xyzz')).toBe(false)
    },
  )
  it('treats punctuation as literal and deduplicates empty/duplicate lines', () => {
    const pattern = buildHighlightPattern({ text: '\nERROR\nERROR\n .* \n', condition: 'contains' })
    expect(pattern).toBe('(?:ERROR|\\.\\*)')
    expect(new RegExp(pattern).test('ordinary')).toBe(false)
  })
  it('matches complete English and Russian words, prefixes and suffixes', () => {
    const words = new RegExp(
      buildHighlightPattern({ text: 'ERROR\nошибка', condition: 'words' }),
      'i',
    )
    expect(words.test('ERROR: ошибка!')).toBe(true)
    expect(words.test('ERRORS ошибками')).toBe(false)
    expect(
      new RegExp(buildHighlightPattern({ text: 'hello', condition: 'starts' })).test('say hello'),
    ).toBe(false)
    expect(
      new RegExp(buildHighlightPattern({ text: 'hello', condition: 'ends' })).test('hello world'),
    ).toBe(false)
  })
  it('decodes all defaults and leaves arbitrary expressions untouched', () => {
    expect(DEFAULT_HIGHLIGHT_RULES.map(readHighlightBuilder)).toEqual([
      { text: 'ERROR\nFAILED', condition: 'words' },
      { text: 'WARN\nWARNING', condition: 'words' },
      { text: 'OK', condition: 'words' },
    ])
    expect(readHighlightBuilder({ ...rule, pattern: '(a+)+$' })).toBeUndefined()
    expect(readHighlightBuilder({ ...rule, pattern: '(?:a.*b)' })).toBeUndefined()
    expect(readHighlightBuilder({ ...rule, pattern: '(?:\\d+)' })).toBeUndefined()
  })
})
