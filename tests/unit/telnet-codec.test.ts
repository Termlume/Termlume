import { it, expect } from 'vitest'
import { TelnetCodec } from '../../src/main/sessions/telnet-codec'
it('fragmentedIacAndEscaped255AreDecoded', () => {
  const codec = new TelnetCodec('utf8'),
    data: number[] = [],
    replies: number[] = []
  for (const byte of [65, 255, 251, 1, 66, 255, 255, 13, 0, 67]) {
    const parsed = codec.feed(Buffer.from([byte]))
    data.push(...parsed.data)
    parsed.replies.forEach((reply) => replies.push(...reply))
  }
  expect(data).toEqual([65, 66, 255, 13, 67])
  expect(replies).toEqual([255, 253, 1])
})
it('unknownOptionRejectedOnce', () => {
  const codec = new TelnetCodec('utf8')
  expect(codec.feed(Buffer.from([255, 253, 42])).replies.map((value) => [...value])).toEqual([
    [255, 252, 42],
  ])
  expect(codec.feed(Buffer.from([255, 253, 42])).replies).toEqual([])
})
it('cp866RoundTripsCyrillic', () => {
  const codec = new TelnetCodec('cp866')
  expect([...codec.encodeInput('Привет')]).toEqual([143, 224, 168, 162, 165, 226])
  expect(codec.decodeOutput(Buffer.from([143, 224, 168, 162, 165, 226]))).toBe('Привет')
})
it('windowSizeEscapes255', () => {
  const codec = new TelnetCodec('utf8')
  codec.feed(Buffer.from([255, 253, 31]))
  expect([...codec.resize(255, 24)!]).toEqual([255, 250, 31, 0, 255, 255, 0, 24, 255, 240])
})
