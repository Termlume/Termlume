import { expect, it } from 'vitest'
import { parseWho } from '../../src/main/monitoring/linux-parsers'

it('preserves sessions, server login text and IPv6 sources', () => {
  expect(
    parseWho('alice pts/0 2026-10-20 10:01 (2001:db8::1)\nalice pts/1 Oct 20 10:02\n'),
  ).toEqual({
    sessions: [
      { user: 'alice', terminal: 'pts/0', loginText: '2026-10-20 10:01', from: '2001:db8::1' },
      { user: 'alice', terminal: 'pts/1', loginText: 'Oct 20 10:02' },
    ],
  })
})
it('accepts an empty successful who but rejects malformed or partially malformed output', () => {
  expect(parseWho(' \n')).toEqual({ sessions: [] })
  expect(() => parseWho('who: permission denied')).toThrow()
  expect(() => parseWho('alice pts/0 2026-10-20 10:01\nbroken')).toThrow()
})
