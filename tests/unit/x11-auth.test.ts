import { describe, expect, it } from 'vitest'
import { rewriteX11Setup, createNativeCookie } from '../../src/main/x11/auth'

function setup(cookie: Buffer, little = true) {
  const name = Buffer.from('MIT-MAGIC-COOKIE-1')
  const data = Buffer.alloc(12 + 20 + 16)
  data[0] = little ? 108 : 66
  const write = little ? data.writeUInt16LE.bind(data) : data.writeUInt16BE.bind(data)
  write(11, 2)
  write(name.length, 6)
  write(cookie.length, 8)
  name.copy(data, 12)
  cookie.copy(data, 32)
  return data
}
describe('X11 setup authentication', () => {
  it('avoids Windows text-mode EOF/newline translation in the native authority file', () => {
    for (let index = 0; index < 100; index++) {
      const cookie = createNativeCookie()
      expect(cookie).toHaveLength(16)
      expect(cookie.includes(26)).toBe(false)
      expect(cookie.includes(13)).toBe(false)
    }
  })
  const remote = Buffer.alloc(16, 1),
    local = Buffer.alloc(16, 2)
  it.each([true, false])('validates and rewrites the setup cookie (little endian %s)', (little) => {
    const input = Buffer.concat([setup(remote, little), Buffer.from('tail')])
    const result = rewriteX11Setup(input, remote, local)!
    expect(result.subarray(32, 48)).toEqual(local)
    expect(result.subarray(48).toString()).toBe('tail')
    expect(input.subarray(32, 48)).toEqual(remote)
  })
  it('waits for fragmented headers', () => {
    expect(rewriteX11Setup(setup(remote).subarray(0, 30), remote, local)).toBeUndefined()
  })
  it('rejects a different cookie, malformed byte order and excessive setup lengths', () => {
    expect(() => rewriteX11Setup(setup(local), remote, local)).toThrow(/cookie/)
    const invalid = setup(remote)
    invalid[0] = 0
    expect(() => rewriteX11Setup(invalid, remote, local)).toThrow()
    const large = setup(remote)
    large.writeUInt16LE(65535, 6)
    expect(() => rewriteX11Setup(large, remote, local)).toThrow()
  })
})
