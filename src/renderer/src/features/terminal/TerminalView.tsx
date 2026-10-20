import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Settings } from '../../../../shared/contracts'
import { terminalTheme } from '../../themes/apply-theme'
import type { SessionOutputRouter } from './SessionOutputRouter'
import { SmoothInputQueue } from './SmoothInputQueue'
import { TerminalOutputHighlighter } from './TerminalOutputHighlighter'
import { MacroInput, filterMacros, isCommandPrompt } from './MacroInput'
import type { TerminalMacro } from '../../../../shared/contracts'
import './macros.css'
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
  const [macroMenu, setMacroMenu] = useState<{
    query: string
    index: number
    style: CSSProperties
  } | null>(null)
  const macroActions = useRef<{
    choose: (macro: TerminalMacro) => void
    cancel: () => void
  } | null>(null)
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
        if (macroInput.query !== null) refreshMacros()
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
    const macroInput = new MacroInput()
    let highlighted = 0
    const refreshMacros = () => {
      if (macroInput.query === null) {
        setMacroMenu(null)
        return
      }
      const pane = element.current!
      const screen = pane.querySelector('.xterm-screen')!.getBoundingClientRect()
      const bounds = pane.getBoundingClientRect()
      const buffer = term.buffer.active
      const rowHeight = screen.height / term.rows
      const cursorTop =
        screen.top - bounds.top + (buffer.baseY + buffer.cursorY - buffer.viewportY) * rowHeight
      const count = filterMacros(settingsRef.current.macros ?? [], macroInput.query).length
      const height = Math.min(
        78 + Math.min(220, Math.max(1, count) * 56 + 8),
        Math.max(0, bounds.height - 16),
      )
      const width = Math.min(520, Math.max(0, bounds.width - 24))
      const left = Math.max(
        12,
        Math.min(
          screen.left - bounds.left + (buffer.cursorX * screen.width) / term.cols,
          bounds.width - width - 12,
        ),
      )
      const top =
        cursorTop + rowHeight + height <= bounds.height - 8
          ? cursorTop + rowHeight
          : Math.max(8, cursorTop - height)
      setMacroMenu({
        query: macroInput.query,
        index: highlighted,
        style: { left, top, width, maxHeight: height },
      })
    }
    const cancelMacro = () => {
      const pending = macroInput.cancel()
      if (pending) window.terminalApi.sessions.write(sessionId, pending).catch(() => {})
      refreshMacros()
    }
    const chooseMacro = (macro: TerminalMacro) => {
      inputQueue.current?.write(macroInput.choose(macro))
      refreshMacros()
      term.focus()
    }
    macroActions.current = { choose: chooseMacro, cancel: cancelMacro }
    const input = term.onData((data) => {
      if (!activeRef.current) return
      const buffer = term.buffer.active
      const line =
        buffer
          .getLine(buffer.baseY + buffer.cursorY)
          ?.translateToString(false, 0, buffer.cursorX) ?? ''
      const atPrompt =
        buffer.type === 'normal' && isCommandPrompt(line) && !!settingsRef.current.macros?.length
      const forwarded = macroInput.feed(data, atPrompt)
      if (forwarded) inputQueue.current?.write(forwarded)
      highlighted = 0
      refreshMacros()
    })
    const outsideMacro = (event: PointerEvent) => {
      if (macroInput.query !== null && !(event.target as Element).closest('.terminal-macros'))
        cancelMacro()
    }
    document.addEventListener('pointerdown', outsideMacro)
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
      if (event.type === 'keydown' && macroInput.query !== null) {
        const items = filterMacros(settingsRef.current.macros ?? [], macroInput.query)
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') cancelMacro()
          else if (event.key === 'Enter' || event.key === 'Tab') {
            if (items.length) chooseMacro(items[Math.min(highlighted, items.length - 1)])
            else {
              cancelMacro()
              inputQueue.current?.write(macroInput.feed(event.key === 'Enter' ? '\r' : '\t', false))
            }
          } else if (items.length) {
            highlighted =
              (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            refreshMacros()
          }
          return false
        }
      }
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
      document.removeEventListener('pointerdown', outsideMacro)
      macroActions.current = null
      term.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [sessionId, output])
  useEffect(() => {
    if (!active) macroActions.current?.cancel()
  }, [active])
  useEffect(() => {
    const input = element.current?.querySelector('.xterm-helper-textarea')
    if (macroMenu) {
      input?.setAttribute('aria-controls', `macro-list-${sessionId}`)
      input?.setAttribute('aria-autocomplete', 'list')
      const selected = filterMacros(settings.macros ?? [], macroMenu.query)[macroMenu.index]
      if (selected)
        input?.setAttribute('aria-activedescendant', `macro-option-${sessionId}-${selected.id}`)
      else input?.removeAttribute('aria-activedescendant')
    } else {
      input?.removeAttribute('aria-controls')
      input?.removeAttribute('aria-autocomplete')
      input?.removeAttribute('aria-activedescendant')
    }
    element.current
      ?.querySelector('.terminal-macros [aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [macroMenu, sessionId, settings.macros])
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
    >
      {active && macroMenu && (
        <div className="terminal-macros" style={macroMenu.style} aria-label="Макросы терминала">
          <div className="terminal-macros-heading">
            <strong>Макросы</strong>
            <code>/{macroMenu.query}</code>
            <kbd>Esc · обычный ввод</kbd>
          </div>
          <div role="listbox" id={`macro-list-${sessionId}`} aria-label="Доступные макросы">
            {filterMacros(settings.macros ?? [], macroMenu.query).map((macro, index) => (
              <button
                key={macro.id}
                type="button"
                role="option"
                id={`macro-option-${sessionId}-${macro.id}`}
                aria-selected={index === macroMenu.index}
                className={index === macroMenu.index ? 'selected' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => macroActions.current?.choose(macro)}
              >
                <span className="terminal-macro-name">
                  /{macro.name}
                  <span>{macro.description}</span>
                </span>
                <code>{macro.command}</code>
              </button>
            ))}
            {!filterMacros(settings.macros ?? [], macroMenu.query).length && (
              <p className="terminal-macros-empty">
                Совпадений нет. Escape вернёт текст в терминал.
              </p>
            )}
          </div>
          <div className="terminal-macros-hint">
            ↑ ↓ выбрать · Enter вставить · повторный Enter выполнить
          </div>
        </div>
      )}
    </div>
  )
}
