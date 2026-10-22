import { afterEach, expect, it, vi } from 'vitest'
import { TerminalCwdTracker } from '../../src/main/sessions/TerminalCwdTracker'
import type { SessionProfile } from '../../src/shared/contracts'

afterEach(() => vi.useRealTimers())
const ssh = { protocol: 'ssh', username: 'shvv' } as SessionProfile
function fixture(profile = ssh) {
  vi.useFakeTimers()
  const paths: string[] = []
  const tracker = new TerminalCwdTracker(profile, (path) => paths.push(path))
  return {
    tracker,
    paths,
    feed: (text: string) => tracker.feed(Buffer.from(text)),
    settle: () => vi.advanceTimersByTimeAsync(121),
  }
}
it('recognizes split OSC7 BEL and ST with URI spaces and split UTF8 without altering bytes', () => {
  const { tracker, paths, feed } = fixture()
  const bytes = Buffer.from('\x1b]7;file://server/home/shvv/Документы%20one\x07')
  for (const byte of bytes) tracker.feed(Uint8Array.of(byte))
  expect(paths).toEqual(['/home/shvv/Документы one'])
  feed('\x1b]7;file:///var/tmp\x1b')
  expect(paths).toHaveLength(1)
  feed('\\')
  expect(paths).toEqual(['/home/shvv/Документы one', '/var/tmp'])
  tracker.close()
})
it('accepts CurrentDir absolute reports and keeps OSC authoritative over later prompt guesses', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('\x1b]1337;CurrentDir=/home/shvv/My folder\x07')
  tracker.input('cd /tmp\r')
  feed('\r\nshvv@host:/wrong$ ')
  await settle()
  expect(paths).toEqual(['/home/shvv/My folder'])
  feed('\x1b]1337;CurrentDir=/tmp\x1b\\')
  expect(paths.at(-1)).toBe('/tmp')
  tracker.close()
})
it('ignores malformed, nonabsolute, oversized and control-character OSC paths then recovers', () => {
  const { tracker, paths, feed } = fixture()
  for (const text of [
    '7;https://server/home',
    '7;file:///bad%ZZ',
    '7;file:///bad%0Aname',
    '7;file:///home?query=1',
    '1337;CurrentDir=relative',
    '1337;CurrentDir=/' + 'x'.repeat(9000),
  ])
    feed(`\x1b]${text}\x07`)
  expect(paths).toEqual([])
  feed('\x1b]7;file:///valid\x07')
  expect(paths).toEqual(['/valid'])
  tracker.close()
})
it('settles split colored Ubuntu prompts and reports home shorthand explicitly', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('\x1b[32mshvv@host\x1b[0m:~')
  await settle()
  expect(paths).toEqual([])
  feed('$ ')
  await settle()
  expect(paths).toEqual(['~'])
  tracker.input('cd "My folder"\r')
  feed('\r\nshvv@host:~/My ')
  feed('folder$ ')
  await settle()
  expect(paths.at(-1)).toBe('~/My folder')
  tracker.close()
})
it('failed cd preserves last cwd and typed commands never become directory guesses', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('shvv@host:/home/shvv$ ')
  await settle()
  tracker.input('cd /missing\r')
  feed('cd /missing\r\nbash: cd: /missing: No such file or directory\r\nshvv@host:/home/shvv$ ')
  await settle()
  expect(paths).toEqual(['/home/shvv'])
  tracker.input('cd /other')
  feed('shvv@host:/other$ ')
  await settle()
  expect(paths).toEqual(['/home/shvv'])
  tracker.close()
})
it('keeps a submitted PowerShell command armed across xterm focus and device responses', async () => {
  const { tracker, paths, feed, settle } = fixture({
    protocol: 'local',
    shell: 'powershell',
    name: 'PowerShell',
  })
  feed('PS C:\\Users\\Vladislav> ')
  await settle()
  tracker.input("Set-Location -LiteralPath 'C:\\folder with spaces'")
  tracker.input('\r')
  tracker.input('\x1b[O')
  feed('\x1b[1;133H\r\n\x1b[0m\x1b[0m')
  tracker.input('\x1b[1;133R')
  feed('PS C:\\folder with spaces> ')
  tracker.input('\x1b[I')
  tracker.input('\x1b[?1;2c')
  await settle()
  expect(paths).toEqual(['C:\\Users\\Vladislav', 'C:\\folder with spaces'])
  tracker.close()
})
it('suppresses newline logs, prefixed text, another username and a changed prompt host', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('shvv@host:/home/shvv$ ')
  await settle()
  for (const text of [
    'shvv@host:/log$ \r\n',
    'log: shvv@host:/log$ ',
    'other@host:/other$ ',
    'shvv@other:/other$ ',
  ]) {
    tracker.input('run\r')
    feed('\r\n' + text)
    await settle()
  }
  expect(paths).toEqual(['/home/shvv'])
  tracker.close()
})
it('suppresses OSC and prompt paths in alternate buffers across chunk boundaries', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('\x1b[?104')
  feed('9;2004h\x1b]7;file:///fullscreen\x07shvv@host:/fake$ ')
  await settle()
  expect(paths).toEqual([])
  feed('\x1b[?1049lshvv@host:/home/shvv$ ')
  await settle()
  expect(paths).toEqual(['/home/shvv'])
  tracker.close()
})
it('recognizes Windows PowerShell and cmd paths with spaces and maps file URIs', async () => {
  for (const shell of ['powershell', 'cmd'] as const) {
    const { tracker, paths, feed, settle } = fixture({ protocol: 'local', shell, name: shell })
    feed(shell === 'powershell' ? 'PS C:\\Users\\Test User> ' : 'C:\\Users\\Test User>')
    await settle()
    expect(paths).toEqual(['C:\\Users\\Test User'])
    feed('\x1b]7;file:///D:/My%20folder\x07')
    expect(paths.at(-1)).toBe('D:\\My folder')
    tracker.close()
  }
})
it('reports WSL POSIX paths for the file layer to map, with no username guess', async () => {
  const { tracker, paths, feed, settle } = fixture({
    protocol: 'wsl',
    distribution: 'Ubuntu',
  } as SessionProfile)
  feed('linuxuser@windows-host:/home/linuxuser$ ')
  await settle()
  expect(paths).toEqual(['/home/linuxuser'])
  tracker.close()
})
it('bounds long untrusted lines and cancels delayed reports on close', async () => {
  const { tracker, paths, feed, settle } = fixture()
  feed('x'.repeat(100000) + 'shvv@host:/fake$ ')
  await settle()
  expect(paths).toEqual([])
  feed('\r\nshvv@host:/home/shvv$ ')
  tracker.close()
  await settle()
  expect(paths).toEqual([])
})
