import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { SHORTCUT_BINDINGS, shortcutId, shortcutKeys } from '../../app/keyboard-shortcuts'
import {
  shortcutChord,
  shortcutBindingsError,
  type ShortcutBindings,
  type ShortcutId,
} from '../../../../shared/keyboard-shortcuts'
import { ru } from '../../app/ru'

export function KeyboardShortcutsDialog({
  onClose,
  bindings = {},
  onSave,
}: {
  onClose: () => void
  bindings?: ShortcutBindings
  onSave?: (bindings: ShortcutBindings) => Promise<void>
}) {
  const [draft, setDraft] = useState<ShortcutBindings>({ ...bindings })
  const [capturing, setCapturing] = useState<ShortcutId>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const validation = shortcutBindingsError(draft)
  async function save() {
    if (validation) return
    setSaving(true)
    setError('')
    try {
      if (onSave) await onSave(draft)
      else await window.terminalApi.settings.update({ shortcutBindings: draft })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить горячие клавиши')
    } finally {
      setSaving(false)
    }
  }
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [])
  return (
    <div className="modal-backdrop">
      <section
        className="modal keyboard-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (capturing) {
              setCapturing(undefined)
              event.preventDefault()
              event.stopPropagation()
            } else onClose()
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <div className="eyebrow">TERMLUME</div>
            <h2>Горячие клавиши</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={ru.close}>
            <X size={17} />
          </button>
        </div>
        <p className="settings-hint">
          Нажмите сочетание справа и задайте новое. Ctrl+C и клавиши копирования терминала защищены.
        </p>
        <table className="keyboard-shortcuts-table">
          <thead>
            <tr>
              <th scope="col">Действие</th>
              <th scope="col">Клавиши</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_BINDINGS.map(({ action, description }) => (
              <tr key={shortcutId(action)}>
                <td>{description}</td>
                <td>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-label={`Изменить: ${description}`}
                    aria-pressed={capturing === shortcutId(action)}
                    disabled={saving}
                    onClick={() => {
                      setCapturing(shortcutId(action))
                      setError('')
                    }}
                    onBlur={() => setCapturing(undefined)}
                    onKeyDown={(event) => {
                      if (capturing !== shortcutId(action)) return
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        setCapturing(undefined)
                        return
                      }
                      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
                      const chord = shortcutChord(event)
                      if (!chord) {
                        setError('Используйте Ctrl или Alt вместе с другой клавишей.')
                        return
                      }
                      setDraft((current) => ({ ...current, [shortcutId(action)]: chord }))
                      setCapturing(undefined)
                      setError('')
                    }}
                  >
                    <kbd>
                      {capturing === shortcutId(action)
                        ? 'Нажмите клавиши…'
                        : shortcutKeys(action, draft)}
                    </kbd>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(error || validation) && (
          <p className="error-message" role="alert">
            {error || validation}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="secondary-button"
            disabled={saving}
            onClick={() => {
              setDraft({})
              setCapturing(undefined)
              setError('')
            }}
          >
            По умолчанию
          </button>
          <button className="secondary-button" disabled={saving} onClick={onClose}>
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={saving || !!validation || !!capturing}
            onClick={() => void save()}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </section>
    </div>
  )
}
