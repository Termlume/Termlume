import {
  MONITOR_ITEMS,
  MONITOR_ITEM_LABELS,
  DEFAULT_MONITOR_ITEMS,
} from '../../../../shared/monitoring-items'
import { useMemo, useState } from 'react'
import { Check, X, Palette, Type } from 'lucide-react'
import { themes } from '../../themes/palettes'
import { ThemeController } from '../../themes/apply-theme'
import type { Settings, ThemeId } from '../../../../shared/contracts'
import { ru } from '../../app/ru'
import { DataTransfer } from './DataTransfer'
import { Updates } from './Updates'
export function Appearance({
  settings,
  onSaved,
  onClose,
  onShortcuts,
}: {
  settings: Settings
  onSaved: (value: Settings) => void
  onClose: () => void
  onShortcuts?: () => void
}) {
  // The settings snapshot can lag behind a preview or another settings update.
  // Opening the dialog must preserve the theme that is actually on screen.
  const [initialTheme] = useState(
    () =>
      themes.find((theme) => theme.id === document.documentElement.dataset.theme)?.id ??
      settings.themeId,
  )
  const [selected, setSelected] = useState(initialTheme),
    [font, setFont] = useState(settings.terminalFont),
    [size, setSize] = useState(settings.terminalFontSize),
    [sftpMode, setSftpMode] = useState(settings.sftpMode),
    [mouseAction, setMouseAction] = useState(settings.mouseAction),
    [localShell, setLocalShell] = useState(settings.localShell),
    [monitoringIntervalSeconds, setMonitoringIntervalSeconds] = useState(
      settings.monitoringIntervalSeconds ?? 3,
    ),
    [smoothInput, setSmoothInput] = useState(settings.smoothInput),
    [monitoringPlacement, setMonitoringPlacement] = useState(
      settings.monitoringPlacement ?? 'sidebar',
    ),
    [monitoringItems, setMonitoringItems] = useState(
      settings.monitoringItems ?? DEFAULT_MONITOR_ITEMS,
    ),
    [error, setError] = useState('')
  const controller = useMemo(
    () =>
      new ThemeController(initialTheme, async (themeId) => {
        await window.terminalApi.settings.update({ themeId })
      }),
    [],
  )
  function cancel() {
    controller.cancel()
    onClose()
  }
  async function save() {
    try {
      await controller.apply()
      onSaved(
        await window.terminalApi.settings.update({
          terminalFont: font,
          terminalFontSize: size,
          sftpMode,
          mouseAction,
          localShell,
          smoothInput,
          monitoringIntervalSeconds,
          monitoringPlacement,
          monitoringItems,
        }),
      )
      onClose()
    } catch (error) {
      setError(String(error))
    }
  }
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel()
      }}
    >
      <section
        className="modal appearance-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ru.appearance}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ПЕРСОНАЛИЗАЦИЯ</span>
            <h2>{ru.appearance}</h2>
          </div>
          <button className="icon-button" onClick={cancel} aria-label={ru.close}>
            <X size={20} />
          </button>
        </div>
        <div className="setting-title">
          <Palette size={17} />
          <strong>{ru.theme}</strong>
        </div>
        <p className="muted small">{ru.themeHint}</p>
        <div className="theme-grid">
          {themes.map((theme) => (
            <button
              key={theme.id}
              aria-label={theme.name}
              aria-pressed={selected === theme.id}
              className={'theme-card ' + (selected === theme.id ? 'chosen' : '')}
              onClick={() => {
                setSelected(theme.id)
                controller.preview(theme.id as ThemeId)
              }}
            >
              <div
                className="theme-preview"
                style={{ background: theme.colors.bg, borderColor: theme.colors.border }}
              >
                <span style={{ background: theme.colors.rail }} />
                <div style={{ background: theme.colors.panel }} />
                <i style={{ background: theme.colors.accent }} />
                <b style={{ background: theme.colors.text }} />
                <em style={{ background: theme.colors.green }} />
              </div>
              <span>
                {theme.name}
                {selected === theme.id && <Check size={14} />}
              </span>
            </button>
          ))}
        </div>
        <div className="setting-title">
          <Type size={17} />
          <strong>Терминал</strong>
        </div>
        <div className="form-row">
          <label>
            {ru.terminalFont}
            <select value={font} onChange={(event) => setFont(event.target.value)}>
              <option value="Cascadia Code, Consolas, monospace">Cascadia Code / Consolas</option>
              <option value="Consolas, monospace">Consolas</option>
              <option value="Courier New, monospace">Courier New</option>
            </select>
          </label>
          <label>
            {ru.fontSize}
            <input
              type="number"
              min={10}
              max={32}
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="setting-title">
          <strong>Поведение приложения</strong>
        </div>
        <div className="form-row">
          <label>
            Режим файлового браузера
            <select
              aria-label="Режим файлового браузера"
              value={sftpMode}
              onChange={(event) => setSftpMode(event.target.value as Settings['sftpMode'])}
            >
              <option value="two-panel">Локальная и удалённая стороны</option>
              <option value="remote-only">Только сервер</option>
            </select>
          </label>
          <label>
            Действия мыши в терминале
            <select
              aria-label="Действия мыши в терминале"
              value={mouseAction}
              onChange={(event) => setMouseAction(event.target.value as Settings['mouseAction'])}
            >
              <option value="select-copy-right-paste">
                Выделение копирует, правый клик вставляет
              </option>
              <option value="context-menu">Контекстное меню</option>
              <option value="manual">Только горячие клавиши и меню</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Локальная оболочка по умолчанию
            <select
              aria-label="Локальная оболочка по умолчанию"
              value={localShell}
              onChange={(event) => setLocalShell(event.target.value as Settings['localShell'])}
            >
              <option value="powershell">PowerShell</option>
              <option value="cmd">Командная строка (cmd)</option>
            </select>
          </label>
          <label className="setting-checkbox">
            <input
              type="checkbox"
              aria-label="Плавная отправка текста"
              checked={smoothInput}
              onChange={(event) => setSmoothInput(event.target.checked)}
            />
            Плавная отправка текста
          </label>
        </div>
        <div className="form-row">
          <label>
            Обновлять мониторинг каждые
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              value={monitoringIntervalSeconds}
              onChange={(event) => setMonitoringIntervalSeconds(Number(event.target.value))}
            />
            <span className="muted small">секунд (от 1 до 60)</span>
          </label>
          <label>
            Расположение мониторинга
            <select
              value={monitoringPlacement}
              onChange={(event) =>
                setMonitoringPlacement(event.target.value as 'sidebar' | 'under-terminal')
              }
            >
              <option value="sidebar">В боковой панели</option>
              <option value="under-terminal">Под терминалом</option>
            </select>
          </label>
        </div>
        {onShortcuts && (
          <button
            className="secondary-button"
            onClick={() => {
              cancel()
              onShortcuts()
            }}
          >
            Настроить горячие клавиши
          </button>
        )}
        {monitoringPlacement === 'under-terminal' && (
          <fieldset className="monitoring-items-settings">
            <legend>Пункты нижнего мониторинга</legend>
            {MONITOR_ITEMS.map((item) => (
              <label className="checkbox-label" key={item}>
                <input
                  type="checkbox"
                  checked={monitoringItems.includes(item)}
                  onChange={() =>
                    setMonitoringItems((current) =>
                      current.includes(item)
                        ? current.filter((value) => value !== item)
                        : [...current, item],
                    )
                  }
                />
                {MONITOR_ITEM_LABELS[item]}
              </label>
            ))}
          </fieldset>
        )}
        <DataTransfer />
        <Updates settings={settings} onSaved={onSaved} />
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={cancel}>
            {ru.cancel}
          </button>
          <button className="primary-button" onClick={save}>
            {ru.apply}
          </button>
        </div>
      </section>
    </div>
  )
}
