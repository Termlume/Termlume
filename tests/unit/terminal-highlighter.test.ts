import { describe, expect, it } from 'vitest'
import { TerminalOutputHighlighter } from '../../src/renderer/src/features/terminal/TerminalOutputHighlighter'

describe('TerminalOutputHighlighter', () => {
  it('highlights whole status words across chunks while preserving ANSI and Unicode', () => {
    const highlighter = new TerminalOutputHighlighter(),
      writes: string[] = []
    const write = (bytes: Uint8Array, done: () => void) => {
      writes.push(new TextDecoder().decode(bytes))
      done()
    }
    highlighter.write(new TextEncoder().encode('\x1b[36mWARN'), write)
    highlighter.write(new TextEncoder().encode('ING Привет ERROR NOTERROR OK!\x1b[0m'), write)
    expect(writes.join('')).toContain('\x1b[36m\x1b[33mWARNING\x1b[36m')
    expect(writes.join('')).toContain('\x1b[31mERROR\x1b[36m')
    expect(writes.join('')).toContain('NOTERROR')
    expect(writes.join('')).toContain('\x1b[32mOK\x1b[36m!')
    expect(writes.join('')).toContain('Привет')
  })

  it('acknowledges chunks that are held until a word boundary arrives', () => {
    const highlighter = new TerminalOutputHighlighter()
    let acknowledgements = 0
    highlighter.write(new TextEncoder().encode('WARN'), (_bytes, done) => {
      acknowledgements++
      done()
    })
    expect(acknowledgements).toBe(1)
  })

  it('does not alter status words inside OSC control sequences', () => {
    const highlighter = new TerminalOutputHighlighter(),
      writes: string[] = []
    highlighter.write(new TextEncoder().encode('\x1b]0;ERROR window\x07OK '), (bytes, done) => {
      writes.push(new TextDecoder().decode(bytes))
      done()
    })
    expect(writes.join('')).toBe('\x1b]0;ERROR window\x07\x1b[32mOK\x1b[39m ')
  })
})
