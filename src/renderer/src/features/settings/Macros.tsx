import { Plus, Trash2, TerminalSquare } from 'lucide-react'
import type { TerminalMacro } from '../../../../shared/contracts'
import './macros.css'

export function Macros({
  value,
  onChange,
  error,
}: {
  value: TerminalMacro[]
  onChange: (value: TerminalMacro[]) => void
  error?: string
}) {
  function update(id: string, patch: Partial<TerminalMacro>) {
    onChange(value.map((macro) => (macro.id === id ? { ...macro, ...patch } : macro)))
  }
  return (
    <section className="macros-settings" aria-labelledby="macros-heading">
      <div className="setting-title">
        <TerminalSquare size={17} />
        <strong id="macros-heading">Макросы</strong>
      </div>
      <p className="muted small">
        Введите / в начале команды в терминале, чтобы выбрать макрос. Выбор вставляет команду; для
        запуска нажмите Enter ещё раз.
      </p>
      {!value.length && (
        <p className="muted small">Макросов пока нет. Добавьте часто используемые команды.</p>
      )}
      <div className="macro-edit-list">
        {value.map((macro, index) => (
          <fieldset className="macro-editor" key={macro.id}>
            <legend>Макрос {index + 1}</legend>
            <div className="macro-editor-heading">
              <label>
                Имя после /
                <input
                  aria-label={`Имя макроса ${index + 1}`}
                  value={macro.name}
                  maxLength={40}
                  placeholder="logs"
                  onChange={(event) => update(macro.id, { name: event.target.value })}
                />
              </label>
              <label>
                Описание
                <input
                  aria-label={`Описание макроса ${index + 1}`}
                  value={macro.description}
                  maxLength={200}
                  placeholder="Последние записи журнала"
                  onChange={(event) => update(macro.id, { description: event.target.value })}
                />
              </label>
              <button
                className="icon-button"
                aria-label={`Удалить макрос ${index + 1}`}
                title="Удалить макрос"
                onClick={() => onChange(value.filter((item) => item.id !== macro.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <label>
              Команда
              <input
                className="macro-command"
                aria-label={`Команда макроса ${index + 1}`}
                value={macro.command}
                maxLength={4096}
                placeholder="journalctl -n 50"
                onChange={(event) => update(macro.id, { command: event.target.value })}
              />
            </label>
          </fieldset>
        ))}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <button
        className="secondary-button macro-add"
        disabled={value.length >= 100}
        onClick={() =>
          onChange([...value, { id: crypto.randomUUID(), name: '', command: '', description: '' }])
        }
      >
        <Plus size={15} />
        Добавить макрос
      </button>
    </section>
  )
}
