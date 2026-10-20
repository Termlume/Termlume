import type { TerminalMacro } from '../../../../shared/contracts'

export function isCommandPrompt(line: string): boolean {
  return /\S.*[$#>%❯➜]\s*$|^[$#>%❯➜]\s*$/.test(line)
}

export function filterMacros(macros: TerminalMacro[], query: string): TerminalMacro[] {
  const search = query.toLocaleLowerCase()
  return macros.filter((macro) =>
    `${macro.name} ${macro.description}`.toLocaleLowerCase().includes(search),
  )
}

// Only the slash query is held locally. Ordinary terminal input and pasted text
// keep their normal path; a selected command is inserted without a newline.
export class MacroInput {
  query: string | null = null
  private typed = ''
  private uncertain = false

  feed(data: string, atPrompt: boolean): string {
    // Xterm also sends terminal capability/focus replies through onData.
    // They must reach the host without being treated as command editing.
    if (/^\x1b(?:\[(?:\??[\d;]*[cnR]|[IO])|\].*(?:\x07|\x1b\\)|P.*\x1b\\)$/s.test(data)) return data
    if (this.query !== null) {
      if (data === '\x03' || data === '\x15') {
        this.query = null
        this.typed = ''
        return data === '\x03' ? data : ''
      }
      if (data === '\x7f' || data === '\b') {
        if (!this.query) this.query = null
        else this.query = Array.from(this.query).slice(0, -1).join('')
        return ''
      }
      if (!/[\x00-\x1f\x7f]/.test(data) && this.query.length + data.length <= 200) {
        this.query += data
        return ''
      }
      return this.cancel() + this.feed(data, false)
    }
    if (data === '/' && atPrompt && !this.typed && !this.uncertain) {
      this.query = ''
      return ''
    }
    if (data === '\r' || data === '\n' || data === '\x03' || data === '\x15') {
      this.typed = ''
      this.uncertain = false
    } else if (data === '\x7f' || data === '\b') {
      this.typed = Array.from(this.typed).slice(0, -1).join('')
    } else if (/[\x00-\x1f\x7f]/.test(data)) {
      this.uncertain = true
    } else {
      this.typed += data
    }
    return data
  }

  cancel(): string {
    if (this.query === null) return ''
    const text = '/' + this.query
    this.query = null
    this.typed = text
    return text
  }

  choose(macro: TerminalMacro): string {
    this.query = null
    this.typed = macro.command
    return macro.command
  }
}
