import { useEffect, useState } from 'react'
import type { HostProfile } from '../../../../shared/contracts'
import type { SessionLogConfig, SessionLogEntry } from '../../../../shared/session-logs'
import './session-logs.css'

export function SessionLogSettings({
  activeSessionId,
  hosts = [],
  onRecordingChange,
}: {
  activeSessionId?: string
  hosts?: HostProfile[]
  onRecordingChange?: (recording: boolean) => void
}) {
  const [config, setConfig] = useState<SessionLogConfig>()
  const [entries, setEntries] = useState<SessionLogEntry[]>([])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const recording = entries.some((e) => e.active && e.sessionId === activeSessionId)
  async function refresh() {
    const values = await window.terminalApi.logs.list()
    setEntries(values)
    onRecordingChange?.(values.some((e) => e.active && e.sessionId === activeSessionId))
  }
  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      await refresh()
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    void run(async () => setConfig(await window.terminalApi.logs.settings()))
    const timer = setInterval(() => void refresh().catch((e) => setError(String(e))), 2000)
    return () => clearInterval(timer)
  }, [activeSessionId])
  useEffect(() => {
    let disposed = false
    setContent('')
    if (selected)
      void window.terminalApi.logs
        .read(selected)
        .then((value) => {
          if (!disposed) setContent(value)
        })
        .catch((e) => setError(String(e)))
    return () => {
      disposed = true
    }
  }, [selected, entries.find((e) => e.id === selected)?.bytes])
  async function update(patch: Partial<SessionLogConfig>) {
    await run(async () => setConfig(await window.terminalApi.logs.configure(patch)))
  }
  const current = entries.find((e) => e.id === selected)
  const lines = search
    ? content
        .split('\n')
        .filter((line) => line.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
        .join('\n')
    : content
  return (
    <section className="settings-section session-journal">
      <h3>Журнал сеансов</h3>
      <p className="muted small">
        Локальная запись вывода терминала. Команды, пароли и ответы в диалогах не записываются
        отдельно; вывод сервера может содержать секреты.
      </p>
      {activeSessionId && (
        <button
          className="secondary-button"
          onClick={() =>
            void run(() =>
              recording
                ? window.terminalApi.logs.stop(activeSessionId)
                : window.terminalApi.logs.start(activeSessionId),
            )
          }
        >
          {recording ? 'Остановить запись' : 'Записывать активный сеанс'}
        </button>
      )}
      {config && (
        <details>
          <summary>Хранение и автоматическая запись</summary>
          <label>
            <input
              type="checkbox"
              checked={config.auto}
              onChange={(e) => void update({ auto: e.target.checked })}
            />
            Автоматически записывать новые сеансы
          </label>
          <p className="muted small">Папка: {config.folder}</p>
          <button
            className="secondary-button"
            onClick={() =>
              void run(async () => {
                const folder = await window.terminalApi.logs.chooseFolder()
                if (folder) setConfig(await window.terminalApi.logs.configure({ folder }))
              })
            }
          >
            Выбрать папку…
          </button>
          <div className="journal-limits">
            <label>
              Хранить дней
              <input
                aria-label="Хранить дней"
                type="number"
                min="1"
                max="3650"
                value={config.retentionDays}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (n >= 1 && n <= 3650) void update({ retentionDays: n })
                }}
              />
            </label>
            <label>
              Лимит МБ
              <input
                aria-label="Лимит МБ"
                type="number"
                min="1"
                max="1024"
                value={config.maxSizeMb}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (n >= 1 && n <= 1024) void update({ maxSizeMb: n })
                }}
              />
            </label>
          </div>
          <p className="muted small">
            Закладки исключаются из очистки. Новая папка применяется к следующим записям.
          </p>
          {!!hosts.length && (
            <details>
              <summary>Автозапись для отдельных хостов</summary>
              {hosts
                .filter((h) => h.protocol !== 'sftp' && h.protocol !== 'ftp')
                .map((h) => (
                  <label key={h.id}>
                    <input
                      type="checkbox"
                      checked={config.hostIds.includes(h.id)}
                      onChange={(e) =>
                        void update({
                          hostIds: e.target.checked
                            ? [...config.hostIds, h.id]
                            : config.hostIds.filter((id) => id !== h.id),
                        })
                      }
                    />
                    {h.name}
                  </label>
                ))}
            </details>
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="journal-browser">
        <div className="journal-list" aria-label="Записи журналов">
          {entries.map((entry) => (
            <button
              className="secondary-button"
              aria-pressed={selected === entry.id}
              key={entry.id}
              onClick={() => setSelected(entry.id)}
            >
              <strong>
                {entry.bookmarked ? '★ ' : ''}
                {entry.label}
              </strong>
              <small>
                {new Date(entry.startedAt).toLocaleString()} · {Math.ceil(entry.bytes / 1024)} КБ
                {entry.active ? ' · запись' : ''}
              </small>
            </button>
          ))}
          {!entries.length && <p className="muted small">Записей пока нет</p>}
        </div>
        <div className="journal-detail">
          {current ? (
            <>
              <div className="journal-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    void run(() =>
                      window.terminalApi.logs.bookmark(current.id, !current.bookmarked),
                    )
                  }
                >
                  {current.bookmarked ? 'Убрать закладку' : 'В закладки'}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void run(() => window.terminalApi.logs.export(current.id))}
                >
                  Экспорт UTF-8…
                </button>
              </div>
              <input
                aria-label="Поиск в журнале"
                placeholder="Поиск по строкам…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <pre tabIndex={0}>{lines || (search ? 'Совпадений нет' : 'Вывода пока нет')}</pre>
            </>
          ) : (
            <p className="muted small">Выберите запись</p>
          )}
        </div>
      </div>
    </section>
  )
}
