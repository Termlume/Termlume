import { afterEach, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionJournal, PlainOutput } from '../../src/main/logs/SessionJournal'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
it('strips split ANSI and OSC while preserving UTF-8 output', () => {
  const plain = new PlainOutput()
  expect(plain.push('\x1b[3')).toBe('')
  expect(plain.push('1mПривет\x1b[0m\r\n\x1b]0;secret')).toBe('Привет\r\n')
  expect(plain.push('\x07OK')).toBe('OK')
})
it('records output, flushes on close and preserves bookmarked logs during rotation', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-journal-'))
  roots.push(root)
  const journal = new SessionJournal(root, () => {})
  await journal.start('session-a', 'Host A')
  journal.output('session-a', '\x1b[32mПривет\x1b[0m\n')
  const utf8 = Buffer.from('世界')
  journal.output('session-a', utf8.subarray(0, 2))
  journal.output('session-a', utf8.subarray(2))
  await journal.stop('session-a')
  const [entry] = await journal.list()
  expect(await journal.read(entry.id)).toBe('Привет\n世界')
  await journal.bookmark(entry.id, true)
  await fs.writeFile(join(root, 'session-logs', 'unrelated.txt'), 'keep')
  await journal.configure({ maxSizeMb: 1 })
  await journal.start('session-b', 'Host B')
  journal.output('session-b', 'x'.repeat(1024 * 1024))
  await journal.close()
  expect((await journal.list()).some((e) => e.id === entry.id)).toBe(true)
  expect(await fs.readFile(join(root, 'session-logs', 'unrelated.txt'), 'utf8')).toBe('keep')
  expect((await journal.list()).every((e) => !e.active)).toBe(true)
})
it('auto recording is opt-in and scoped to selected hosts', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-journal-'))
  roots.push(root)
  const journal = new SessionJournal(root, () => {})
  await journal.autoStart('a', 'host-a', 'A')
  expect(await journal.list()).toHaveLength(0)
  await journal.configure({ hostIds: ['host-a'] })
  await journal.autoStart('b', 'host-a', 'A')
  expect(await journal.list()).toHaveLength(1)
  await journal.close()
})
it('flushes the disconnected recording and starts a distinct file for reconnect', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'termlume-journal-'))
  roots.push(root)
  const journal = new SessionJournal(root, () => {})
  await journal.configure({ auto: true })
  await journal.autoStart('old-session', 'host', 'Host')
  journal.output('old-session', 'before disconnect\n')
  await journal.stop('old-session')
  journal.output('old-session', 'ignored after close')
  await journal.autoStart('new-session', 'host', 'Host')
  journal.output('new-session', 'after reconnect\n')
  await journal.close()
  const entries = await journal.list()
  expect(entries).toHaveLength(2)
  const old = entries.find((e) => e.sessionId === 'old-session')!
  const next = entries.find((e) => e.sessionId === 'new-session')!
  expect(old.id).not.toBe(next.id)
  expect(await journal.read(old.id)).toBe('before disconnect\n')
  expect(await journal.read(next.id)).toBe('after reconnect\n')
})
