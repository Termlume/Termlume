import {
  normalizeLocalShell,
  localShellOptions,
  localShellLabels,
} from '../../../../shared/local-shells'
import { Credentials } from './Credentials'
import { HighlightRulesEditor } from './HighlightRulesEditor'
import { DEFAULT_HIGHLIGHT_RULES } from '../../../../shared/highlight-rules'
import { highlightRulesSchema } from '../../../../shared/schemas'
import {
  DEFAULT_MONITOR_ITEMS,
  configuredMonitorOrder,
  mergeMonitorOrder,
} from '../../../../shared/monitoring-items'
import { MonitorItemsEditor } from '../monitoring/MonitorItemsEditor'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Check,
  X,
  Palette,
  TerminalSquare,
  Folder,
  Activity,
  KeyRound,
  Command,
  Highlighter,
  Archive,
  Download,
} from 'lucide-react'
import './settings-layout.css'
import { themes } from '../../themes/palettes'
import { ThemeController } from '../../themes/apply-theme'
import { SessionLogSettings } from './SessionLogSettings'
import { X11Settings } from './X11Settings'
import type { HostProfile, Settings, ThemeId } from '../../../../shared/contracts'
import { ru } from '../../app/ru'
import { DataTransfer } from './DataTransfer'
import { DownloadSettings } from './DownloadSettings'
import { Updates } from './Updates'
import { Macros } from './Macros'
import { terminalMacrosSchema } from '../../../../shared/schemas'
const sections = [
  {
    id: 'appearance',
    label: 'Внешний вид',
    icon: Palette,
    hint: 'Цветовая тема приложения и терминала.',
  },
  {
    id: 'terminal',
    label: 'Терминал',
    icon: TerminalSquare,
    hint: 'Шрифт, мышь и локальная оболочка.',
  },
  {
    id: 'files',
    label: 'Файлы',
    icon: Folder,
    hint: 'Отображение браузера и место сохранения файлов.',
  },
  {
    id: 'monitoring',
    label: 'Мониторинг',
    icon: Activity,
    hint: 'Расположение, частота обновления и порядок показателей.',
  },
  {
    id: 'credentials',
    label: 'Учётные данные',
    icon: KeyRound,
    hint: 'Общие логины, пароли и ключи для ваших серверов.',
  },
  {
    id: 'macros',
    label: 'Библиотека команд',
    icon: Command,
    hint: 'Частые команды, доступные по / в терминале.',
  },
  {
    id: 'journals',
    label: 'Журналы сеансов',
    icon: Archive,
    hint: 'Запись, поиск и сохранение вывода терминала.',
  },
  {
    id: 'x11',
    label: 'Графика X11',
    icon: TerminalSquare,
    hint: 'Графические приложения SSH на этом компьютере.',
  },
  {
    id: 'highlighting',
    label: 'Подсветка',
    icon: Highlighter,
    hint: 'Выделение нужных слов и строк в выводе терминала.',
  },
  {
    id: 'backup',
    label: 'Резервные копии',
    icon: Archive,
    hint: 'Безопасное сохранение и перенос ваших подключений.',
  },
  {
    id: 'updates',
    label: 'Обновления',
    icon: Download,
    hint: 'Версия приложения и канал обновлений.',
  },
] as const
type SectionId = (typeof sections)[number]['id']
export function Appearance({
  settings,
  onSaved,
  onClose,
  onShortcuts,
  hosts = [],
  activeSessionId,
}: {
  settings: Settings
  onSaved: (value: Settings) => void
  onClose: () => void
  onShortcuts?: () => void
  hosts?: HostProfile[]
  activeSessionId?: string
}) {
  const [section, setSection] = useState<SectionId>('appearance')
  const [credentialsDirty, setCredentialsDirty] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [section])
  function navigate(event: KeyboardEvent<HTMLElement>) {
    const index = sections.findIndex((item) => item.id === section)
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % sections.length
        : event.key === 'ArrowUp'
          ? (index + sections.length - 1) % sections.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? sections.length - 1
              : -1
    if (next < 0) return
    event.preventDefault()
    setSection(sections[next].id)
    dialogRef.current?.querySelector<HTMLElement>(`#settings-tab-${sections[next].id}`)?.focus()
  }
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
    [localShell, setLocalShell] = useState(
      normalizeLocalShell(settings.localShell, window.terminalApi.platform),
    ),
    [monitoringIntervalSeconds, setMonitoringIntervalSeconds] = useState(
      settings.monitoringIntervalSeconds ?? 3,
    ),
    [smoothInput, setSmoothInput] = useState(settings.smoothInput),
    [macros, setMacros] = useState(settings.macros ?? []),
    [highlightRules, setHighlightRules] = useState(
      settings.highlightRules ?? DEFAULT_HIGHLIGHT_RULES,
    ),
    [macroError, setMacroError] = useState(''),
    [monitoringPlacement, setMonitoringPlacement] = useState(
      settings.monitoringPlacement ?? 'sidebar',
    ),
    [monitoringOrder, setMonitoringOrder] = useState(
      configuredMonitorOrder(settings.monitoringItems, settings.monitoringOrder),
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
    if (credentialsDirty) {
      setSection('credentials')
      setError('Сначала сохраните учётные данные отдельной кнопкой или отмените их изменения.')
      return
    }
    const parsedRules = highlightRulesSchema.safeParse(highlightRules)
    if (!parsedRules.success) {
      setSection('highlighting')
      setError(parsedRules.error.issues[0]?.message ?? 'Проверьте правила подсветки.')
      return
    }
    const parsedMacros = terminalMacrosSchema.safeParse(macros)
    if (!parsedMacros.success) {
      setSection('macros')
      setMacroError(parsedMacros.error.issues[0]?.message ?? 'Проверьте макросы.')
      document.getElementById('macros-heading')?.scrollIntoView({ block: 'center' })
      return
    }
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
          monitoringOrder,
          macros: parsedMacros.data,
          highlightRules: parsedRules.data,
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
        if (event.key === 'Tab') {
          const items = [
            ...(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
            ) ?? []),
          ].filter((item) => !item.closest('[hidden]') && item.getAttribute('tabindex') !== '-1')
          const first = items[0],
            last = items[items.length - 1]
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
      <section
        className="modal appearance-modal settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
      >
        <div className="modal-heading">
          <div>
            <h2>Настройки</h2>
          </div>
          <button className="icon-button" onClick={cancel} aria-label={ru.close}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-workspace">
          <nav
            className="settings-nav"
            role="tablist"
            aria-label="Разделы настроек"
            aria-orientation="vertical"
            onKeyDown={navigate}
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-controls={`settings-panel-${id}`}
                aria-selected={section === id}
                tabIndex={section === id ? 0 : -1}
                key={id}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content" ref={contentRef}>
            <section
              role="tabpanel"
              id="settings-panel-appearance"
              aria-labelledby="settings-tab-appearance"
              hidden={section !== 'appearance'}
              tabIndex={0}
              className="settings-page settings-page-appearance"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'appearance')!.label}</h3>
                <p>{sections.find((item) => item.id === 'appearance')!.hint}</p>
              </header>
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
            </section>
            <section
              role="tabpanel"
              id="settings-panel-terminal"
              aria-labelledby="settings-tab-terminal"
              hidden={section !== 'terminal'}
              tabIndex={0}
              className="settings-page settings-page-terminal"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'terminal')!.label}</h3>
                <p>{sections.find((item) => item.id === 'terminal')!.hint}</p>
              </header>
              <div className="form-row">
                <label>
                  {ru.terminalFont}
                  <select value={font} onChange={(event) => setFont(event.target.value)}>
                    <option value="Cascadia Code, Consolas, monospace">
                      Cascadia Code / Consolas
                    </option>
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
              <div className="form-row">
                {' '}
                <label>
                  Действия мыши в терминале
                  <select
                    aria-label="Действия мыши в терминале"
                    value={mouseAction}
                    onChange={(event) =>
                      setMouseAction(event.target.value as Settings['mouseAction'])
                    }
                  >
                    <option value="select-copy-right-paste">
                      Выделение копирует, правый клик вставляет
                    </option>
                    <option value="context-menu">Контекстное меню</option>
                    <option value="manual">Только горячие клавиши и меню</option>
                  </select>
                </label>
              </div>{' '}
              <div className="form-row">
                <label>
                  Локальная оболочка по умолчанию
                  <select
                    aria-label="Локальная оболочка по умолчанию"
                    value={localShell}
                    onChange={(event) =>
                      setLocalShell(event.target.value as Settings['localShell'])
                    }
                  >
                    {localShellOptions(window.terminalApi.platform).map((shell) => (
                      <option key={shell} value={shell}>
                        {shell === 'cmd' ? 'Командная строка (cmd)' : localShellLabels[shell]}
                      </option>
                    ))}
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
            </section>
            <section
              role="tabpanel"
              id="settings-panel-files"
              aria-labelledby="settings-tab-files"
              hidden={section !== 'files'}
              tabIndex={0}
              className="settings-page settings-page-files"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'files')!.label}</h3>
                <p>{sections.find((item) => item.id === 'files')!.hint}</p>
              </header>
              <div className="form-row">
                {' '}
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
              </div>
              <DownloadSettings settings={settings} onSaved={onSaved} />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-monitoring"
              aria-labelledby="settings-tab-monitoring"
              hidden={section !== 'monitoring'}
              tabIndex={0}
              className="settings-page settings-page-monitoring"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'monitoring')!.label}</h3>
                <p>{sections.find((item) => item.id === 'monitoring')!.hint}</p>
              </header>
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
              <p>Общие показатели для подключений без индивидуальной настройки:</p>
              <MonitorItemsEditor
                value={monitoringItems}
                order={monitoringOrder}
                onChange={(items) => {
                  setMonitoringItems(items)
                  setMonitoringOrder((previous) => mergeMonitorOrder(previous, items))
                }}
              />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-credentials"
              aria-labelledby="settings-tab-credentials"
              hidden={section !== 'credentials'}
              tabIndex={0}
              className="settings-page settings-page-credentials"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'credentials')!.label}</h3>
                <p>{sections.find((item) => item.id === 'credentials')!.hint}</p>
              </header>
              <Credentials onDirtyChange={setCredentialsDirty} />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-macros"
              aria-labelledby="settings-tab-macros"
              hidden={section !== 'macros'}
              tabIndex={0}
              className="settings-page settings-page-macros"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'macros')!.label}</h3>
                <p>{sections.find((item) => item.id === 'macros')!.hint}</p>
              </header>
              <Macros
                hosts={hosts}
                value={macros}
                onChange={(value) => {
                  setMacros(value)
                  setMacroError('')
                }}
                error={macroError}
              />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-journals"
              aria-labelledby="settings-tab-journals"
              hidden={section !== 'journals'}
              tabIndex={0}
              className="settings-page"
            >
              {section === 'journals' && (
                <SessionLogSettings hosts={hosts} activeSessionId={activeSessionId} />
              )}
            </section>
            <section
              role="tabpanel"
              id="settings-panel-x11"
              aria-labelledby="settings-tab-x11"
              hidden={section !== 'x11'}
              tabIndex={0}
              className="settings-page"
            >
              {section === 'x11' && <X11Settings settings={settings} onSaved={onSaved} />}
            </section>
            <section
              role="tabpanel"
              id="settings-panel-highlighting"
              aria-labelledby="settings-tab-highlighting"
              hidden={section !== 'highlighting'}
              tabIndex={0}
              className="settings-page settings-page-highlighting"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'highlighting')!.label}</h3>
                <p>{sections.find((item) => item.id === 'highlighting')!.hint}</p>
              </header>
              <HighlightRulesEditor
                active={section === 'highlighting'}
                value={highlightRules}
                onChange={(rules) => setHighlightRules(rules ?? DEFAULT_HIGHLIGHT_RULES)}
              />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-backup"
              aria-labelledby="settings-tab-backup"
              hidden={section !== 'backup'}
              tabIndex={0}
              className="settings-page settings-page-backup"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'backup')!.label}</h3>
                <p>{sections.find((item) => item.id === 'backup')!.hint}</p>
              </header>
              <DataTransfer />
            </section>
            <section
              role="tabpanel"
              id="settings-panel-updates"
              aria-labelledby="settings-tab-updates"
              hidden={section !== 'updates'}
              tabIndex={0}
              className="settings-page settings-page-updates"
            >
              <header className="settings-page-heading">
                <h3>{sections.find((item) => item.id === 'updates')!.label}</h3>
                <p>{sections.find((item) => item.id === 'updates')!.hint}</p>
              </header>
              <Updates settings={settings} onSaved={onSaved} />
            </section>
          </div>
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions settings-footer">
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
