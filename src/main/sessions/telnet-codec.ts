import iconv from 'iconv-lite'
export class TelnetCodec {
  private state: 'data' | 'iac' | 'option' | 'sub' | 'sub-iac' = 'data'
  private command = 0
  private sub: number[] = []
  private local = new Set<number>()
  private remote = new Set<number>()
  private refused = new Set<string>()
  private cols = 80
  private rows = 24
  private cr = false
  private decoder: ReturnType<typeof iconv.getDecoder>
  constructor(private encoding: string) {
    this.decoder = iconv.getDecoder(encoding)
  }
  decodeOutput(data: Buffer) {
    return this.decoder.write(data)
  }
  feed(chunk: Buffer): { data: Buffer; replies: Buffer[] } {
    const data: number[] = [],
      replies: Buffer[] = []
    for (const byte of chunk) {
      if (this.state === 'data') {
        if (byte === 255) this.state = 'iac'
        else {
          if (this.cr && byte === 0) {
            this.cr = false
            continue
          }
          data.push(byte)
          this.cr = byte === 13
        }
      } else if (this.state === 'iac') {
        if (byte === 255) {
          data.push(255)
          this.state = 'data'
        } else if ([251, 252, 253, 254].includes(byte)) {
          this.command = byte
          this.state = 'option'
        } else if (byte === 250) {
          this.sub = []
          this.state = 'sub'
        } else this.state = 'data'
      } else if (this.state === 'option') {
        this.negotiate(this.command, byte, replies)
        this.state = 'data'
      } else if (this.state === 'sub') {
        if (byte === 255) this.state = 'sub-iac'
        else this.sub.push(byte)
      } else if (this.state === 'sub-iac') {
        if (byte === 255) {
          this.sub.push(255)
          this.state = 'sub'
        } else if (byte === 240) {
          if (this.sub[0] === 24 && this.sub[1] === 1 && this.local.has(24))
            replies.push(Buffer.from([255, 250, 24, 0, ...Buffer.from('xterm-256color'), 255, 240]))
          this.state = 'data'
          this.sub = []
        } else this.state = 'data'
      }
      if (this.sub.length > 4096) throw new Error('Malformed Telnet subnegotiation')
    }
    return { data: Buffer.from(data), replies }
  }
  private negotiate(command: number, option: number, replies: Buffer[]) {
    const supported =
      command === 253
        ? [3, 24, 31].includes(option)
        : command === 251
          ? [1, 3].includes(option)
          : false
    const enabled = command === 253 ? this.local : this.remote
    if (command === 253 || command === 251) {
      if (supported && !enabled.has(option)) {
        enabled.add(option)
        replies.push(Buffer.from([255, command === 253 ? 251 : 253, option]))
        if (command === 253 && option === 31) replies.push(this.resize(this.cols, this.rows)!)
      } else if (!supported && !this.refused.has(command + ':' + option)) {
        this.refused.add(command + ':' + option)
        replies.push(Buffer.from([255, command === 253 ? 252 : 254, option]))
      }
    } else {
      const set = command === 254 ? this.local : this.remote
      if (set.delete(option)) replies.push(Buffer.from([255, command === 254 ? 252 : 254, option]))
    }
  }
  encodeInput(text: string): Buffer {
    const bytes = iconv.encode(text.replace(/\r\n|\r|\n/g, '\r\n'), this.encoding),
      escaped: number[] = []
    for (const byte of bytes) {
      escaped.push(byte)
      if (byte === 255) escaped.push(255)
    }
    return Buffer.from(escaped)
  }
  resize(cols: number, rows: number): Buffer | undefined {
    this.cols = cols
    this.rows = rows
    if (!this.local.has(31)) return undefined
    const raw = Buffer.alloc(4)
    raw.writeUInt16BE(cols, 0)
    raw.writeUInt16BE(rows, 2)
    const escaped: number[] = []
    for (const byte of raw) {
      escaped.push(byte)
      if (byte === 255) escaped.push(255)
    }
    return Buffer.from([255, 250, 31, ...escaped, 255, 240])
  }
}
