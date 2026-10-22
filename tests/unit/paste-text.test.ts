import { describe, expect, it } from 'vitest'
import { needsPastePreview } from '../../src/renderer/src/features/terminal/paste-text'
describe('multiline paste detection', () => {
  it('previews multiple nonempty commands across Windows and Unix newlines', () => {
    expect(needsPastePreview('one\ntwo')).toBe(true)
    expect(needsPastePreview('one\r\ntwo')).toBe(true)
    expect(needsPastePreview('one\rthree')).toBe(true)
  })
  it('does not interrupt single line text, trailing newlines or blank clipboard', () => {
    for (const text of ['', 'one', 'one\r\n', '\n one \n \n', ' \n\t'])
      expect(needsPastePreview(text)).toBe(false)
  })
})
