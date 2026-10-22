import type { HighlightRule } from './highlight-rules'
export type HighlightCondition = 'contains' | 'words' | 'starts' | 'ends'
export interface HighlightBuilder {
  text: string
  condition: HighlightCondition
}
const boundary = '[A-Za-zА-Яа-яЁё0-9_]'
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function buildHighlightPattern(builder: HighlightBuilder): string {
  const terms = [
    ...new Set(
      builder.text
        .split('\n')
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ]
  if (!terms.length) return ''
  const alternatives = '(?:' + terms.map(escape).join('|') + ')'
  switch (builder.condition) {
    case 'words':
      return `(?<!${boundary})${alternatives}(?!${boundary})`
    case 'starts':
      return '^' + alternatives
    case 'ends':
      return alternatives + '$'
    default:
      return alternatives
  }
}
/** Recognize only expressions whose exact meaning the builder preserves. */
export function readHighlightBuilder(rule: HighlightRule): HighlightBuilder | undefined {
  if (rule.mode === 'literal' && !/[\r\n]/.test(rule.pattern))
    return { text: rule.pattern, condition: 'contains' }
  const defaults: Record<string, string> = {
    '\\b(?:ERROR|FAILED)\\b': 'ERROR\nFAILED',
    '\\bWARN(?:ING)?\\b': 'WARN\nWARNING',
    '\\bOK\\b': 'OK',
  }
  if (defaults[rule.pattern]) return { text: defaults[rule.pattern], condition: 'words' }
  let expression = rule.pattern,
    condition: HighlightCondition = 'contains'
  if (expression.startsWith(`(?<!${boundary})`) && expression.endsWith(`(?!${boundary})`)) {
    expression = expression.slice(`(?<!${boundary})`.length, -`(?!${boundary})`.length)
    condition = 'words'
  } else if (expression.startsWith('^')) {
    expression = expression.slice(1)
    condition = 'starts'
  } else if (expression.endsWith('$')) {
    expression = expression.slice(0, -1)
    condition = 'ends'
  }
  if (!expression.startsWith('(?:') || !expression.endsWith(')')) return undefined
  expression = expression.slice(3, -1)
  const terms = ['']
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index]
    if (character === '\\') {
      const next = expression[++index]
      if (!next || !/[.*+?^${}()|[\]\\]/.test(next)) return undefined
      terms[terms.length - 1] += next
    } else if (character === '|') terms.push('')
    else terms[terms.length - 1] += character
  }
  const builder = { text: terms.join('\n'), condition }
  return buildHighlightPattern(builder) === rule.pattern ? builder : undefined
}
