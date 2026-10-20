import { it, expect } from 'vitest'
import { TelnetAdapter } from '../../src/main/sessions/TelnetAdapter'
import { telnetFixture } from './fixtures/telnet-server'
it('negotiatesFragmentedProtocolAndDecodesSplitUtf8', async () => {
  const server = await telnetFixture(),
    adapter = new TelnetAdapter({
      id: 'test',
      name: 'test',
      protocol: 'telnet',
      host: '127.0.0.1',
      port: server.port,
      encoding: 'utf8',
      group: '',
      favorite: false,
    })
  let output = ''
  adapter.subscribe((event) => {
    if (event.type === 'data') output += Buffer.from(event.data).toString('utf8')
  })
  try {
    await adapter.connect(new AbortController().signal)
    await expect.poll(() => output).toBe('ПРИВЕТ\r\n')
    adapter.resize(120, 40)
    adapter.write('hello\r')
    await expect
      .poll(() => Buffer.concat(server.received).includes(Buffer.from('hello\r\n')))
      .toBe(true)
    expect(Buffer.concat(server.received).includes(Buffer.from([255, 251, 31]))).toBe(true)
    expect(Buffer.concat(server.received).includes(Buffer.from('hello\r\n'))).toBe(true)
  } finally {
    await adapter.close()
    await server.close()
  }
})
