import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Settings } from '../../../../shared/contracts'
import { terminalTheme } from '../../themes/apply-theme'
import type { SessionOutputRouter } from './SessionOutputRouter'
import { SmoothInputQueue } from './SmoothInputQueue'
import { TerminalOutputHighlighter } from './TerminalOutputHighlighter'
import '@xterm/xterm/css/xterm.css'
export function TerminalView({
  sessionId,
  active,
  settings,
  output,
  onFontSizeChange,
}: {
  sessionId: string
  active: boolean
  settings: Settings
  output: SessionOutputRouter
  onFontSizeChange?: (fontSize: number) => void
}) {
  const element = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    fit = useRef<FitAddon | null>(null),
    activeRef = useRef(active),
    settingsRef = useRef(settings),
    fontSizeHandlerRef = useRef(onFontSizeChange),
    inputQueue = useRef<SmoothInputQueue | null>(null)
  activeRef.current = active
  settingsRef.current = settings
  fontSizeHandlerRef.current = onFontSizeChange
  useEffect(() => {
    const term = new Terminal({
      theme: terminalTheme(settings.themeId),
      fontFamily: settings.terminalFont,
      fontSize: settings.terminalFontSize,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: false,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(element.current!)
    terminal.current = term
    fit.current = fitAddon
    inputQueue.current = new SmoothInputQueue((data) => {
      if (activeRef.current) window.terminalApi.sessions.write(sessionId, data).catch(() => {})
    }, settings.smoothInput)
    const highlighter = new TerminalOutputHighlighter()
    const fitVisible = () => {
      if (element.current?.clientWidth && element.current?.clientHeight) {
        fitAddon.fit()
        window.terminalApi.sessions.resize(sessionId, term.cols, term.rows).catch(() => {})
      }
    }
    const observer = new ResizeObserver(fitVisible)
    observer.observe(element.current!)
    const off = output.subscribe(sessionId, (bytes, sequence) =>
      highlighter.write(bytes, (displayBytes, done) =>
        term.write(displayBytes, () => {
          done()
          window.terminalApi.sessions.ack(sessionId, sequence).catch(() => {})
        }),
      ),
    )
    const input = term.onData((data) => {
      inputQueue.current?.write(data)
    })
    const previewTheme = (event: Event) => {
      term.options.theme = terminalTheme((event as CustomEvent<Settings['themeId']>).detail)
    }
    window.addEventListener('terminal-theme-change', previewTheme)
    const selection = term.onSelectionChange(() => {
      if (settingsRef.current.mouseAction === 'select-copy-right-paste' && term.hasSelection())
        navigator.clipboard.writeText(term.getSelection()).catch(() => {})
    })
    const onContextMenu = (event: MouseEvent) => {
      if (settingsRef.current.mouseAction !== 'select-copy-right-paste') return
      event.preventDefault()
      if (!term.hasSelection())
        navigator.clipboard
          .readText()
          .then((text) => term.paste(text))
          .catch(() => {})
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !fontSizeHandlerRef.current) return
      event.preventDefault()
      const current = terminal.current?.options.fontSize ?? settings.terminalFontSize
      const next = Math.max(10, Math.min(32, current + (event.deltaY < 0 ? 1 : -1)))
      if (next !== current) fontSizeHandlerRef.current(next)
    }
    element.current?.addEventListener('contextmenu', onContextMenu)
    element.current?.addEventListener('wheel', onWheel, { passive: false })
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.code === 'KeyC') {
        if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      if (event.code === 'KeyV') {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (activeRef.current) term.paste(text)
          })
          .catch(() => {})
        return false
      }
      return true
    })
    fitVisible()
    return () => {
      observer.disconnect()
      off()
      input.dispose()
      selection.dispose()
      inputQueue.current?.close()
      inputQueue.current = null
      element.current?.removeEventListener('contextmenu', onContextMenu)
      element.current?.removeEventListener('wheel', onWheel)
      window.removeEventListener('terminal-theme-change', previewTheme)
      term.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [sessionId, output])
  useEffect(() => {
    inputQueue.current?.setEnabled(settings.smoothInput)
    if (terminal.current) {
      terminal.current.options.theme = terminalTheme(settings.themeId)
      terminal.current.options.fontFamily = settings.terminalFont
      terminal.current.options.fontSize = settings.terminalFontSize
      if (active)
        requestAnimationFrame(() => {
          fit.current?.fit()
          terminal.current?.focus()
        })
    }
  }, [active, settings])
  return (
    <div
      ref={element}
      className={'terminal-pane ' + (active ? 'active' : '')}
      data-session-id={sessionId}
    />
  )
}
