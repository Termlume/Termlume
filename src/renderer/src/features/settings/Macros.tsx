import { useState } from 'react'
import { Plus, Trash2, TerminalSquare } from 'lucide-react'
import type { HostProfile, TerminalMacro } from '../../../../shared/contracts'
import { COMMAND_PRESETS, macroFromPreset } from '../../../../shared/command-presets'
import './macros.css'

export function Macros({
  value,
  onChange,
  error,
  hosts = [],
}: {
  value: TerminalMacro[]
  onChange: (value: TerminalMacro[]) => void
  error?: string
  hosts?: HostProfile[]
}) {
  const [selectedId, setSelectedId] = useState(value[0]?.id || '')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const selected = value.find((item) => item.id === selectedId) || value[0]
  const index = selected ? value.indexOf(selected) + 1 : 0
  const categories = [
    ...new Set(value.map((item) => item.category).filter((c): c is string => !!c)),
  ].sort()
  const filtered = value.filter(
    (item) =>
      (!category || item.category === category) &&
      `${item.name} ${item.description} ${item.command} ${item.category || ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  )
  function update(patch: Partial<TerminalMacro>) {
    onChange(value.map((item) => (item.id === selected?.id ? { ...item, ...patch } : item)))
  }
  return (
    <section className="macros-settings" aria-labelledby="macros-heading">
      <div className="setting-title">
        <TerminalSquare size={17} />
        <strong id="macros-heading">Библиотека команд</strong>
      </div>
      <p className="muted small">
        Введите / в начале команды в терминале. Выбор вставляет команду; для запуска нажмите Enter
        ещё раз.
      </p>
      <div className="macro-library-toolbar">
        <input
          aria-label="Поиск команд"
          placeholder="Поиск по имени, команде или описанию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Фильтр категории"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          className="secondary-button macro-add"
          disabled={value.length >= 100}
          onClick={() => {
            const macro = { id: crypto.randomUUID(), name: '', command: '', description: '' }
            onChange([...value, macro])
            setSelectedId(macro.id)
            setQuery('')
            setCategory('')
          }}
        >
          <Plus size={15} />
          Добавить
        </button>
      </div>
      <select
        aria-label="Добавить из примеров"
        value=""
        disabled={value.length >= 100}
        onChange={(event) => {
          const preset = COMMAND_PRESETS[Number(event.target.value)]
          if (!preset) return
          const macro = macroFromPreset(preset, value, crypto.randomUUID())
          onChange([...value, macro])
          setSelectedId(macro.id)
          setQuery('')
          setCategory('')
        }}
      >
        <option value="" disabled>
          Добавить из примеров…
        </option>
        {COMMAND_PRESETS.map((preset, index) => (
          <option key={preset.name} value={index}>
            {preset.category} · {preset.description}
          </option>
        ))}
      </select>
      <div className="macro-library">
        <div className="macro-library-list" aria-label="Команды библиотеки">
          {filtered.map((item) => (
            <button
              className="secondary-button"
              key={item.id}
              aria-pressed={item.id === selected?.id}
              onClick={() => setSelectedId(item.id)}
            >
              <strong>/{item.name || 'Новая команда'}</strong>
              <span>{item.description || item.command || 'Добавьте описание'}</span>
              <small>
                {item.category || 'Без категории'}
                {item.hostIds?.length ? ` · хостов: ${item.hostIds.length}` : ' · все хосты'}
              </small>
            </button>
          ))}
          {!filtered.length && (
            <p className="muted small">
              {value.length ? 'Совпадений нет' : 'Добавьте часто используемые команды.'}
            </p>
          )}
        </div>
        {selected ? (
          <fieldset className="macro-editor">
            <legend>Команда {index}</legend>
            <div className="macro-editor-heading">
              <label>
                Имя после /
                <input
                  aria-label={`Имя макроса ${index}`}
                  value={selected.name}
                  maxLength={40}
                  placeholder="logs"
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <button
                className="icon-button"
                aria-label={`Удалить макрос ${index}`}
                title="Удалить команду"
                onClick={() => {
                  const next = value.filter((item) => item.id !== selected.id)
                  onChange(next)
                  setSelectedId(next[0]?.id || '')
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <label>
              Описание
              <input
                aria-label={`Описание макроса ${index}`}
                value={selected.description}
                maxLength={200}
                placeholder="Последние записи журнала"
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <label>
              Команда
              <input
                className="macro-command"
                aria-label={`Команда макроса ${index}`}
                value={selected.command}
                maxLength={4096}
                placeholder="journalctl -n 50"
                onChange={(e) => update({ command: e.target.value })}
              />
            </label>
            <label>
              Категория
              <input
                aria-label="Категория команды"
                list="macro-categories"
                value={selected.category || ''}
                maxLength={60}
                placeholder="Например, диагностика"
                onChange={(e) => update({ category: e.target.value })}
              />
              <datalist id="macro-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <details>
              <summary>
                Доступность на хостах
                {selected.hostIds?.length ? ` (${selected.hostIds.length})` : ' · все хосты'}
              </summary>
              <p className="muted small">Без выбора команда доступна во всех терминалах.</p>
              {hosts
                .filter((h) => h.protocol !== 'sftp' && h.protocol !== 'ftp')
                .map((host) => (
                  <label className="macro-host" key={host.id}>
                    <input
                      type="checkbox"
                      checked={selected.hostIds?.includes(host.id) || false}
                      onChange={(e) =>
                        update({
                          hostIds: e.target.checked
                            ? [...(selected.hostIds || []), host.id]
                            : selected.hostIds?.filter((id) => id !== host.id),
                        })
                      }
                    />
                    {host.name}
                  </label>
                ))}
              {selected.hostIds?.some((id) => !hosts.some((h) => h.id === id)) && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    update({
                      hostIds: selected.hostIds?.filter((id) => hosts.some((h) => h.id === id)),
                    })
                  }
                >
                  Убрать недоступные хосты
                </button>
              )}
            </details>
          </fieldset>
        ) : (
          <p className="muted small macro-empty">Выберите команду для редактирования.</p>
        )}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  )
}
