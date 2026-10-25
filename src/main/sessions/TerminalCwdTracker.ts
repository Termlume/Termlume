import { StringDecoder } from 'node:string_decoder'
import type { SessionProfile } from '../../shared/contracts'

const MAX_PATH = 4096
const cleanPath = (path: string) =>
  path.length > 0 && path.length <= MAX_PATH && !/[\x00-\x1f\x7f]/.test(path)

/** Observes shell output only; never writes a command or changes terminal bytes. */
export class TerminalCwdTracker {
  private decoder = new StringDecoder('utf8')
  private mode:
    'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'discard-osc' | 'discard-escape' = 'text'
  private sequence = ''
  private line = ''
  private lineOverflow = false
  private alternate = false
  private armed = true
  private promptHost?: string
  private lastPath?: string
  private authoritative = false
  private closed = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private profile: SessionProfile,
    private report: (path: string) => void,
  ) {}

  input(data: string) {
    if (this.closed) return
    // xterm sends these through the same write API as keystrokes. A focus change,
    // cursor-position response or device-attributes reply must not cancel the
    // prompt expected after Enter, or clear a prompt waiting for its settle timer.
    if (/^(?:\x1b\[(?:[?=>]?[0-9;]*[Rcnt]|[IO]))+$/.test(data)) return
    this.cancelTimer()
    this.line = ''
    this.lineOverflow = false
    // A new prompt is expected only after submission or interrupt, not while editing a command.
    this.armed = /[\r\n\x03]/.test(data)
  }

  feed(data: Uint8Array) {
    if (this.closed) return
    this.cancelTimer()
    for (const char of this.decoder.write(Buffer.from(data))) this.character(char)
    if (
      !this.authoritative &&
      !this.alternate &&
      this.armed &&
      this.mode === 'text' &&
      !this.lineOverflow &&
      this.promptPath()
    ) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        const candidate = this.promptPath()
        if (candidate && this.armed && !this.alternate) {
          if (candidate.host) this.promptHost = candidate.host
          this.publish(candidate.path)
          this.armed = false
        }
      }, 120)
    }
  }

  close() {
    this.closed = true
    this.cancelTimer()
    this.sequence = this.line = ''
    this.decoder = new StringDecoder('utf8')
  }

  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private publish(path: string, authoritative = false) {
    if (this.alternate || !cleanPath(path)) return
    if (authoritative) this.authoritative = true
    if (path === this.lastPath) return
    this.lastPath = path
    this.report(path)
  }

  private promptPath(): { path: string; host?: string } | undefined {
    if (
      this.profile.protocol === 'local' &&
      (this.profile.shell === 'cmd' || this.profile.shell === 'powershell')
    ) {
      const match =
        this.profile.shell === 'powershell'
          ? /^PS ((?:[A-Za-z]:\\|\\\\)[^<>|?*\r\n]*)> $/.exec(this.line)
          : /^((?:[A-Za-z]:\\|\\\\)[^<>|?*\r\n]*)> ?$/.exec(this.line)
      return match && cleanPath(match[1]) ? { path: match[1] } : undefined
    }
    if (
      this.profile.protocol !== 'ssh' &&
      this.profile.protocol !== 'wsl' &&
      this.profile.protocol !== 'local'
    )
      return
    const match =
      /^([A-Za-z_][\w.-]*)@([A-Za-z0-9][\w.-]*):((?:\/[^\r\n]*|~(?:\/[^\r\n]*)?))[$#] $/.exec(
        this.line,
      )
    if (!match || !cleanPath(match[3])) return
    if (this.profile.protocol === 'ssh' && match[1] !== this.profile.username) return
    if (this.promptHost && match[2] !== this.promptHost) return
    return { path: match[3], host: match[2] }
  }

  private osc(text: string) {
    if (this.alternate) return
    if (text.startsWith('7;')) {
      try {
        const uri = new URL(text.slice(2))
        if (
          uri.protocol !== 'file:' ||
          uri.search ||
          uri.hash ||
          uri.username ||
          uri.password ||
          uri.port
        )
          return
        let path = decodeURIComponent(uri.pathname)
        if (
          this.profile.protocol === 'local' &&
          (this.profile.shell === 'cmd' || this.profile.shell === 'powershell')
        ) {
          if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1).replace(/\//g, '\\')
          else if (uri.hostname) path = `\\\\${uri.hostname}${path.replace(/\//g, '\\')}`
          else return
        } else if (!path.startsWith('/')) return
        this.publish(path, true)
      } catch {
        /* Invalid URI or percent escape is not a cwd report. */
      }
    } else if (text.startsWith('1337;CurrentDir=')) {
      const path = text.slice('1337;CurrentDir='.length)
      if (
        this.profile.protocol === 'local' &&
        (this.profile.shell === 'cmd' || this.profile.shell === 'powershell')
          ? /^(?:[A-Za-z]:\\|\\\\)/.test(path)
          : path.startsWith('/')
      )
        this.publish(path, true)
    }
  }

  private character(char: string) {
    if (this.mode === 'discard-osc' || this.mode === 'discard-escape') {
      if (char === '\x07' || (this.mode === 'discard-escape' && char === '\\')) this.mode = 'text'
      else this.mode = char === '\x1b' ? 'discard-escape' : 'discard-osc'
      return
    }
    if (this.mode === 'osc' || this.mode === 'osc-escape') {
      if (char === '\x07' || (this.mode === 'osc-escape' && char === '\\')) {
        this.osc(this.sequence)
        this.sequence = ''
        this.mode = 'text'
      } else if (char === '\x1b') this.mode = 'osc-escape'
      else {
        this.sequence += (this.mode === 'osc-escape' ? '\x1b' : '') + char
        this.mode = this.sequence.length > 8192 ? 'discard-osc' : 'osc'
        if (this.mode === 'discard-osc') this.sequence = ''
      }
      return
    }
    if (this.mode === 'csi') {
      this.sequence += char
      if (/[\x40-\x7e]/.test(char)) {
        const modes = /^\?([0-9;]+)[hl]$/.exec(this.sequence)
        if (modes?.[1].split(';').some((mode) => ['47', '1047', '1049'].includes(mode))) {
          this.alternate = char === 'h'
          this.line = ''
          this.lineOverflow = false
        }
        this.mode = 'text'
        this.sequence = ''
      } else if (this.sequence.length > 128) {
        this.mode = 'text'
        this.sequence = ''
        this.lineOverflow = true
      }
      return
    }
    if (this.mode === 'escape') {
      this.mode = char === '[' ? 'csi' : char === ']' ? 'osc' : 'text'
      this.sequence = ''
      return
    }
    if (char === '\x1b') {
      this.mode = 'escape'
      return
    }
    if (this.alternate) return
    if (char === '\r' || char === '\n') {
      this.line = ''
      this.lineOverflow = false
    } else if (char === '\b') this.line = this.line.slice(0, -1)
    else if (char >= ' ' && char !== '\x7f') {
      if (this.line.length < MAX_PATH + 512) this.line += char
      else this.lineOverflow = true
    } else if (char !== '\x07') this.lineOverflow = true
  }
}
