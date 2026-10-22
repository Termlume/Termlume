import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './paste-preview.css'

export function PastePreview({
  text,
  target,
  onChange,
  onConfirm,
  onCancel,
}: {
  text: string
  target: string
  onChange: (text: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const editor = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const numbers = useRef<HTMLDivElement>(null)
  const lineCount = text.replace(/\r\n?/g, '\n').split('\n').length
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    editor.current?.focus()
    return () => previous?.focus()
  }, [])
  return createPortal(
    <div
      className="modal-backdrop paste-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-preview-heading"
        className="modal paste-preview-dialog"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Tab') {
            const items = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), textarea',
              ) ?? []),
            ]
            const first = items[0],
              last = items.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className="modal-heading">
          <div>
            <h2 id="paste-preview-heading">Вставка нескольких строк</h2>
            <p className="muted small">
              Сессия: <strong>{target}</strong> · Строк: {lineCount}
            </p>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Отменить вставку">
            <X size={18} />
          </button>
        </header>
        <p className="muted small">
          Проверьте текст перед отправкой в терминал. Его можно отредактировать.
        </p>
        <div className="paste-preview-editor">
          <div className="paste-preview-lines" ref={numbers} aria-hidden="true">
            {Array.from({ length: Math.min(lineCount, 5000) }, (_, index) => index + 1).join('\n')}
          </div>
          <textarea
            ref={editor}
            aria-label="Текст для вставки"
            spellCheck={false}
            value={text}
            wrap="off"
            onChange={(event) => onChange(event.target.value)}
            onScroll={(event) => {
              if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop
            }}
          />
        </div>
        <footer className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>
            Отмена
          </button>
          <button className="primary-button" disabled={!text.length} onClick={onConfirm}>
            Вставить в терминал
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
