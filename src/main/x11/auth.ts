import { randomBytes, timingSafeEqual } from 'node:crypto'

export const X11_AUTH_PROTOCOL = 'MIT-MAGIC-COOKIE-1'
const padded = (length: number) => (length + 3) & ~3

export function createNativeCookie() {
  // VcXsrv 21.1.16.1 opens Xauthority in Windows text mode: ^Z truncates
  // the record and CRLF is translated. Rejection sampling retains >127 bits.
  for (;;) {
    const cookie = randomBytes(16)
    if (!cookie.includes(26) && !cookie.includes(13)) return cookie
    cookie.fill(0)
  }
}

/** Returns undefined until the entire setup is available. Never mutates input. */
export function rewriteX11Setup(
  input: Buffer,
  remoteCookie: Buffer,
  localCookie: Buffer,
): Buffer | undefined {
  if (input.length < 12) return undefined
  if (input[0] !== 108 && input[0] !== 66) throw new Error('Invalid X11 byte order')
  const read = input[0] === 108 ? input.readUInt16LE.bind(input) : input.readUInt16BE.bind(input)
  const nameLength = read(6),
    cookieLength = read(8)
  if (read(2) !== 11 || nameLength !== X11_AUTH_PROTOCOL.length || cookieLength !== 16)
    throw new Error('Unsupported X11 authentication setup')
  const cookieOffset = 12 + padded(nameLength)
  const length = cookieOffset + padded(cookieLength)
  if (input.length < length) return undefined
  if (input.subarray(12, 12 + nameLength).toString('ascii') !== X11_AUTH_PROTOCOL)
    throw new Error('Unsupported X11 authentication protocol')
  if (
    remoteCookie.length !== 16 ||
    localCookie.length !== 16 ||
    !timingSafeEqual(input.subarray(cookieOffset, cookieOffset + cookieLength), remoteCookie)
  )
    throw new Error('Invalid X11 authentication cookie')
  const output = Buffer.from(input)
  localCookie.copy(output, cookieOffset)
  return output
}

export function xauthority(cookie: Buffer, display: number) {
  const field = (value: Buffer) => {
    const size = Buffer.alloc(2)
    size.writeUInt16BE(value.length)
    return Buffer.concat([size, value])
  }
  // FamilyWild supports the TCP endpoint and VcXsrv's internal window manager.
  return Buffer.concat([
    Buffer.from([255, 255]),
    field(Buffer.alloc(0)),
    field(Buffer.from(String(display))),
    field(Buffer.from(X11_AUTH_PROTOCOL)),
    field(cookie),
  ])
}

export function x11Setup(cookie?: Buffer) {
  const name = cookie ? Buffer.from(X11_AUTH_PROTOCOL) : Buffer.alloc(0)
  const output = Buffer.alloc(12 + padded(name.length) + (cookie?.length || 0))
  output[0] = 108
  output.writeUInt16LE(11, 2)
  output.writeUInt16LE(name.length, 6)
  output.writeUInt16LE(cookie?.length || 0, 8)
  name.copy(output, 12)
  cookie?.copy(output, 12 + padded(name.length))
  return output
}
