type Write = (bytes: Uint8Array, done: () => void) => void

export class TerminalOutputHighlighter {
  private readonly decoder = new TextDecoder()
  private pending = ''
  private sgr = ''
  private readonly encoder = new TextEncoder()

  write(bytes: Uint8Array, write: Write) {
    this.pending += this.decoder.decode(bytes, { stream: true })
    const trailingWord = /(?:\x1b\[[0-?]*[ -/]*m)*([A-Za-z0-9_]+)$/.exec(this.pending)
    const partialStatus =
      trailingWord && ['OK', 'WARNING', 'ERROR'].some((word) => word.startsWith(trailingWord[1]))
    const cut = partialStatus ? trailingWord!.index : this.pending.length
    if (partialStatus && this.pending.length < 256) {
      const safe = this.pending.slice(0, cut)
      this.pending = this.pending.slice(cut)
      write(this.encoder.encode(this.transform(safe)), () => {})
      return
    }
    const safe = this.pending.slice(0, cut)
    this.pending = this.pending.slice(cut)
    write(this.encoder.encode(this.transform(safe)), () => {})
  }

  private transform(text: string) {
    const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|.)/gs
    let output = '',
      cursor = 0,
      match: RegExpExecArray | null
    while ((match = ansi.exec(text))) {
      output += this.highlight(text.slice(cursor, match.index)) + match[0]
      if (match[0].startsWith('\x1b[') && match[0].endsWith('m')) {
        this.sgr = /(?:^|;)0(?:;|$)/.test(match[0].slice(2, -1))
          ? ''
          : (this.sgr + match[0]).slice(-256)
      }
      cursor = ansi.lastIndex
    }
    return output + this.highlight(text.slice(cursor))
  }

  private highlight(text: string) {
    return text.replace(/\b(OK|WARNING|ERROR)\b/g, (word) => {
      const color = word === 'OK' ? 32 : word === 'WARNING' ? 33 : 31
      return `\x1b[${color}m${word}${this.sgr || '\x1b[39m'}`
    })
  }
}
