import { MAX_HIGHLIGHT_LINE, type HighlightRule } from '../../../../shared/highlight-rules'

// Executed in a disposable worker: even a pathological user expression cannot block the UI.
export class HighlightEngine {
  private sgr: string[] = []
  private control = ''
  private mode: 'text' | 'escape' | 'intermediate' | 'csi' | 'osc' | 'string' = 'text'
  transform(text: string, rules: HighlightRule[]): string {
    const tokens: { text: string; control?: boolean; sgr?: string }[] = []
    let plain = '',
      escape = ''
    const flush = () => {
      if (plain) {
        tokens.push({ text: plain })
        plain = ''
      }
    }
    for (const char of text) {
      if (this.mode === 'text') {
        if (char === '\x1b') {
          flush()
          this.mode = 'escape'
          this.control = char
          escape += char
        } else plain += char
        continue
      }
      escape += char
      const previous = this.control.slice(-1)
      this.control = (this.control + char).slice(-4096)
      let complete = false
      if (this.mode === 'escape') {
        if (char === '[') this.mode = 'csi'
        else if (char === ']') this.mode = 'osc'
        else if ('PX^_'.includes(char)) this.mode = 'string'
        else if (char >= ' ' && char <= '/') this.mode = 'intermediate'
        else complete = true
      } else if (this.mode === 'intermediate') {
        complete = char >= '0' && char <= '~'
      } else if (this.mode === 'csi') complete = char >= '@' && char <= '~'
      else
        complete =
          (this.mode === 'osc' && char === '\x07') || (previous === '\x1b' && char === '\\')
      if (complete) {
        tokens.push({
          text: escape,
          control: true,
          sgr: /^\x1b\[[0-9;:]*m$/.test(this.control) ? this.control : undefined,
        })
        escape = ''
        this.mode = 'text'
        this.control = ''
      }
    }
    flush()
    if (escape) tokens.push({ text: escape, control: true })
    let line: typeof tokens = [],
      output = ''
    for (const token of tokens) {
      if (token.control) {
        line.push(token)
        continue
      }
      for (const part of token.text.split(/(\r?\n)/)) {
        if (/^\r?\n$/.test(part)) {
          output += this.line(line, rules) + part
          line = []
        } else if (part) line.push({ text: part })
      }
    }
    return output + this.line(line, rules)
  }
  private line(
    tokens: { text: string; control?: boolean; sgr?: string }[],
    rules: HighlightRule[],
  ): string {
    const plain = tokens
      .filter((token) => !token.control)
      .map((token) => token.text)
      .join('')
    const colors: (string | undefined)[] = new Array(plain.length)
    // Incomplete escape sequences and oversized lines pass through untouched.
    if (plain.length <= MAX_HIGHLIGHT_LINE && !plain.includes('\x1b')) {
      for (const rule of rules.filter((item) => item.enabled)) {
        const pattern =
          rule.mode === 'literal'
            ? rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : rule.pattern
        let regex: RegExp
        try {
          regex = new RegExp(pattern, rule.caseSensitive ? 'g' : 'gi')
        } catch {
          continue
        }
        let match: RegExpExecArray | null,
          count = 0
        while ((match = regex.exec(plain)) && count++ < 256) {
          if (!match[0].length) {
            regex.lastIndex++
            continue
          }
          const start = rule.wholeLine ? 0 : match.index
          const end = rule.wholeLine ? plain.length : match.index + match[0].length
          for (let i = start; i < end; i++) colors[i] ??= rule.color
          if (rule.wholeLine) break
        }
      }
    }
    let offset = 0
    return tokens
      .map(({ text: token, control, sgr }) => {
        if (control) {
          if (sgr) {
            const reset = /^\x1b\[(?:0;|0?m)/.test(sgr)
            if (reset) this.sgr = []
            this.sgr.push(sgr)
            while (
              this.sgr.length > 1 &&
              this.sgr.reduce((length, item) => length + item.length, 0) > 1024
            )
              this.sgr.shift()
          }
          return token
        }
        let result = '',
          cursor = 0
        while (cursor < token.length) {
          const color = colors[offset + cursor]
          let end = cursor + 1
          while (end < token.length && colors[offset + end] === color) end++
          const part = token.slice(cursor, end)
          if (color) {
            const rgb = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16)).join(';')
            result += `\x1b[38;2;${rgb}m${part}\x1b[0m${this.sgr.join('')}`
          } else result += part
          cursor = end
        }
        offset += token.length
        return result
      })
      .join('')
  }
}
