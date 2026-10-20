import { useEffect, useId, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'

export type CommandAction = {
  id: string
  label: string
  detail?: string
  shortcut?: string
  run: () => void
}

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: CommandAction[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = actions.filter((action) => {
    const text = `${action.label} ${action.detail || ''}`.toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
  const active = Math.min(selected, Math.max(0, matches.length - 1))
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, query])
  const execute = (action: CommandAction) => {
    onClose()
    action.run()
  }
  return (
    <div
      className="modal-backdrop command-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="modal command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Палитра команд"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            input.current?.focus()
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (matches.length)
              setSelected(
                (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
              )
          }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (matches[active]) execute(matches[active])
          }
        }}
      >
        <div className="command-search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-label="Найти команду или подключение"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={matches.length ? `${id}-${active}` : undefined}
            placeholder="Команда или подключение…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        <div
          className="command-results"
          role="listbox"
          aria-label="Команды"
          id={`${id}-list`}
          ref={list}
        >
          {matches.map((action, index) => (
            <div
              key={action.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              className="command-option"
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => execute(action)}
            >
              <span>
                <strong>{action.label}</strong>
                {action.detail && <small>{action.detail}</small>}
              </span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
              {index === active && <CornerDownLeft size={14} aria-hidden="true" />}
            </div>
          ))}
        </div>
        {!matches.length && (
          <p className="command-empty" role="status">
            Ничего не найдено. Попробуйте другое название.
          </p>
        )}
        <div className="command-footer" aria-hidden="true">
          <span>↑ ↓ выбрать</span>
          <span>Enter выполнить</span>
          <span>Esc закрыть</span>
        </div>
      </section>
    </div>
  )
}
