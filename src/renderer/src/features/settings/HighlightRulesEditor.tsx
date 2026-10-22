import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_HIGHLIGHT_RULES,
  HIGHLIGHT_PRESETS,
  highlightRuleError,
  type HighlightRule,
} from '../../../../shared/highlight-rules'
import {
  buildHighlightPattern,
  readHighlightBuilder,
  type HighlightCondition,
} from '../../../../shared/highlight-builder'
import { AsyncOutputHighlighter } from '../terminal/AsyncOutputHighlighter'
import './highlight-rules.css'

export function HighlightRulesEditor({
  value,
  onChange,
  inherited = false,
  active = true,
}: {
  value: HighlightRule[] | undefined
  onChange: (rules: HighlightRule[] | undefined) => void
  inherited?: boolean
  active?: boolean
}) {
  const rules = value ?? DEFAULT_HIGHLIGHT_RULES
  const [selectedId, setSelectedId] = useState(rules[0]?.id)
  const [sample, setSample] = useState(
    'OK: service started\nWARNING: disk space low\nERROR: connection FAILED',
  )
  const [preview, setPreview] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    if (!active || (inherited && value === undefined)) return
    const current = ++generation.current
    const processor = new AsyncOutputHighlighter(
      (text, done) => {
        if (current === generation.current) setPreview(text)
        done()
      },
      rules.filter((rule) => !highlightRuleError(rule)),
    )
    processor.write(new TextEncoder().encode(sample.slice(0, 8192)), () => {})
    return () => processor.dispose()
  }, [sample, value, inherited, active])
  const index = Math.max(
    0,
    rules.findIndex((rule) => rule.id === selectedId),
  )
  const selected = rules[index]
  function update(patch: Partial<HighlightRule>) {
    onChange(rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  }
  function move(direction: number) {
    const next = [...rules],
      target = index + direction
    if (target < 0 || target >= rules.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSelectedId(selected.id)
    onChange(next)
  }
  return (
    <section className="highlight-settings">
      <h3>Подсветка вывода терминала</h3>
      {inherited && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value === undefined}
            onChange={(event) =>
              onChange(event.target.checked ? undefined : structuredClone(DEFAULT_HIGHLIGHT_RULES))
            }
          />
          Использовать общие правила
        </label>
      )}
      {(!inherited || value !== undefined) && (
        <>
          <p className="muted small">
            Выберите правило и укажите слова или фразы. Первое подходящее правило имеет приоритет.
          </p>
          <div className="highlight-workspace">
            <div className="highlight-rule-list" aria-label="Правила подсветки">
              {rules.map((rule) => (
                <button
                  type="button"
                  className={'highlight-rule-item ' + (selected?.id === rule.id ? 'active' : '')}
                  key={rule.id}
                  aria-pressed={selected?.id === rule.id}
                  onClick={() => setSelectedId(rule.id)}
                >
                  <span className="highlight-swatch" style={{ background: rule.color }} />
                  <span>
                    <strong>{rule.name || 'Без названия'}</strong>
                    <small>
                      {rule.enabled ? 'Включено' : 'Выключено'} ·{' '}
                      {readHighlightBuilder(rule) ? 'Слова и фразы' : 'Своё выражение'}
                    </small>
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="secondary-button highlight-add"
                disabled={rules.length >= 30}
                onClick={() => {
                  const id = crypto.randomUUID()
                  onChange([
                    ...rules,
                    {
                      id,
                      name: 'Новое правило',
                      pattern: 'ERROR',
                      mode: 'literal',
                      color: '#ef6461',
                      caseSensitive: false,
                      wholeLine: false,
                      enabled: true,
                    },
                  ])
                  setSelectedId(id)
                }}
              >
                <Plus size={15} />
                Добавить правило
              </button>
            </div>
            {selected ? (
              <div className="highlight-rule-detail">
                <div className="highlight-rule-toolbar">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selected.enabled}
                      onChange={(event) => update({ enabled: event.target.checked })}
                    />
                    Включено
                  </label>
                  <div>
                    <button
                      type="button"
                      title="Выше"
                      aria-label="Переместить правило выше"
                      disabled={index === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      title="Ниже"
                      aria-label="Переместить правило ниже"
                      disabled={index === rules.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      title="Удалить правило"
                      aria-label={`Удалить правило ${selected.name}`}
                      onClick={() => onChange(rules.filter((rule) => rule.id !== selected.id))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <label>
                  Название
                  <input
                    value={selected.name}
                    maxLength={80}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <RuleCondition key={selected.id} rule={selected} onChange={update} />
                <div className="highlight-color-options">
                  <label>
                    Цвет
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(event) => update({ color: event.target.value })}
                    />
                  </label>
                  <label>
                    Что окрашивать
                    <select
                      value={selected.wholeLine ? 'line' : 'match'}
                      onChange={(event) => update({ wholeLine: event.target.value === 'line' })}
                    >
                      <option value="match">Найденный текст</option>
                      <option value="line">Всю строку</option>
                    </select>
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selected.caseSensitive}
                    onChange={(event) => update({ caseSensitive: event.target.checked })}
                  />
                  Учитывать регистр
                </label>
                {highlightRuleError(selected) && (
                  <p className="error-message" role="alert">
                    {highlightRuleError(selected)}
                  </p>
                )}
              </div>
            ) : (
              <p className="muted">Пока нет правил. Добавьте первое правило.</p>
            )}
          </div>
          <details className="highlight-presets">
            <summary>Готовые правила</summary>
            <p className="muted small">
              Добавляйте только нужные правила. Цвет, слова и порядок можно изменить после
              добавления.
            </p>
            <div className="highlight-preset-list">
              {HIGHLIGHT_PRESETS.map((preset) => {
                const exists = rules.some(
                  (rule) => rule.pattern === preset.rule.pattern && rule.mode === preset.rule.mode,
                )
                return (
                  <div className="highlight-preset" key={preset.key}>
                    <span className="highlight-swatch" style={{ background: preset.rule.color }} />
                    <div>
                      <strong>{preset.rule.name}</strong>
                      <p className="muted small">{preset.description}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={exists || rules.length >= 30}
                      aria-label={`${exists ? 'Добавлено' : 'Добавить'}: ${preset.rule.name}`}
                      onClick={() => {
                        if (exists) return
                        const id = crypto.randomUUID()
                        onChange([...rules, { ...preset.rule, id }])
                        setSelectedId(id)
                      }}
                    >
                      {exists ? 'Добавлено' : 'Добавить'}
                    </button>
                  </div>
                )
              })}
            </div>
          </details>
          <details className="highlight-test" open>
            <summary>Проверить на примере</summary>
            <label>
              Текст для проверки
              <textarea
                value={sample}
                maxLength={8192}
                rows={3}
                onChange={(event) => setSample(event.target.value)}
              />
            </label>
            <pre className="highlight-preview" aria-label="Предпросмотр подсветки">
              {renderPreview(preview)}
            </pre>
          </details>
        </>
      )}
    </section>
  )
}

function RuleCondition({
  rule,
  onChange,
}: {
  rule: HighlightRule
  onChange: (patch: Partial<HighlightRule>) => void
}) {
  const decoded = readHighlightBuilder(rule)
  const [advanced, setAdvanced] = useState(!decoded)
  const [confirmBuilder, setConfirmBuilder] = useState(false)
  const [draft, setDraft] = useState(
    decoded ?? { text: '', condition: 'contains' as HighlightCondition },
  )
  function build(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    onChange({ pattern: buildHighlightPattern(next), mode: 'regex' })
  }
  return (
    <>
      {!advanced && (
        <>
          <label>
            Слова и фразы
            <textarea
              aria-label="Слова и фразы"
              value={draft.text}
              rows={3}
              maxLength={256}
              placeholder={'ERROR\nFAILED\nОшибка подключения'}
              onChange={(event) => build({ text: event.target.value })}
            />
          </label>
          <p className="muted small highlight-field-help">
            Каждое слово или фразу — с новой строки. Достаточно любого совпадения.
          </p>
          <label>
            Условие
            <select
              value={draft.condition}
              onChange={(event) => build({ condition: event.target.value as HighlightCondition })}
            >
              <option value="contains">Строка содержит</option>
              <option value="words">Только целые слова</option>
              <option value="starts">Строка начинается с</option>
              <option value="ends">Строка заканчивается на</option>
            </select>
          </label>
        </>
      )}
      <details className="highlight-advanced">
        <summary>Расширенные настройки</summary>
        {advanced ? (
          <>
            <p className="muted small">
              Используется своё выражение. Оно сохранится без изменений, пока вы его не
              отредактируете.
            </p>
            <label>
              Регулярное выражение
              <input
                value={rule.pattern}
                maxLength={256}
                onChange={(event) => onChange({ pattern: event.target.value, mode: 'regex' })}
              />
            </label>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (decoded) {
                  setDraft(decoded)
                  setAdvanced(false)
                } else setConfirmBuilder(true)
              }}
            >
              Перейти к словам и фразам
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              Для сложных условий можно самостоятельно задать регулярное выражение.
            </p>
            <button type="button" className="text-button" onClick={() => setAdvanced(true)}>
              Редактировать регулярное выражение
            </button>
          </>
        )}
      </details>
      {advanced && (
        <p className="muted small">
          Своё выражение · откройте расширенные настройки для редактирования.
        </p>
      )}
      {confirmBuilder && (
        <div
          className="highlight-confirm"
          role="alertdialog"
          aria-label="Перейти к простому условию"
        >
          <p>Заменить своё выражение словами и фразами? Текущее выражение будет очищено.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setConfirmBuilder(false)}
          >
            Сохранить выражение
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setAdvanced(false)
              setConfirmBuilder(false)
              setDraft({ text: '', condition: 'contains' })
              onChange({ pattern: '', mode: 'regex' })
            }}
          >
            Заменить условие
          </button>
        </div>
      )}
    </>
  )
}

function renderPreview(text: string) {
  let color: string | undefined
  return text.split(/(\x1b\[[0-9;]*m)/).map((part, index) => {
    if (part.startsWith('\x1b')) {
      const match = /^\x1b\[38;2;(\d+);(\d+);(\d+)m$/.exec(part)
      color = match ? `rgb(${match[1]},${match[2]},${match[3]})` : undefined
      return null
    }
    return (
      <span key={index} style={{ color }}>
        {part}
      </span>
    )
  })
}
