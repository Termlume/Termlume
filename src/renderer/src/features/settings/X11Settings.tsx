import { useEffect, useState } from 'react'
import type { Settings, X11Status } from '../../../../shared/contracts'

export function X11Settings({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: (value: Settings) => void
}) {
  const windows = window.terminalApi.platform !== 'linux'
  const [status, setStatus] = useState<X11Status>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () =>
      window.terminalApi.x11
        .status()
        .then((value) => {
          if (active) setStatus(value)
        })
        .catch((error) => {
          if (active) setError(String(error))
        })
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  async function update(patch: Partial<Settings>) {
    try {
      onSaved(await window.terminalApi.settings.update(patch))
      setError('')
    } catch (error) {
      setError(String(error))
    }
  }
  async function control(action: 'start' | 'stop') {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.terminalApi.x11[action]())
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  const labels = {
    stopped: 'Остановлен',
    starting: 'Запускается…',
    running: 'Работает',
    error: 'Ошибка',
  }
  return (
    <section className="settings-section">
      <h3>Графические приложения X11</h3>
      <p className="muted small">
        {windows
          ? 'Встроенный VcXsrv открывает графические приложения SSH в отдельных окнах Windows.'
          : 'Используется X-сервер рабочего стола Linux (DISPLAY и Xauthority), включая XWayland. Войдите в графическую сессию перед запуском Termlume.'}{' '}
        Включите X11 в свойствах нужного SSH-подключения.
      </p>
      {windows && (
        <>
          <label>
            <input
              type="checkbox"
              checked={settings.x11Autostart ?? true}
              onChange={(event) => void update({ x11Autostart: event.target.checked })}
            />
            Запускать X-сервер при подключении с X11
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.x11Clipboard ?? true}
              onChange={(event) => void update({ x11Clipboard: event.target.checked })}
            />
            Общий буфер обмена Windows и X11
          </label>
          <p className="muted small">
            Изменение буфера обмена применяется при следующем запуске X-сервера. Доверенные
            X11-приложения могут обращаться к другим X11-окнам и общему буферу обмена.
          </p>
        </>
      )}
      <p role="status">
        X-сервер: {status ? labels[status.state] : 'Проверка…'}
        {status?.activeSessions ? ` · SSH-сеансов: ${status.activeSessions}` : ''}
      </p>
      {windows && status && !status.available && (
        <p className="error-message">
          VcXsrv не включён в эту сборку. Для разработки выполните npm run prepare:x11.
        </p>
      )}
      {status?.message && <p className="error-message">{status.message}</p>}
      {windows && (
        <div className="settings-actions">
          <button
            className="secondary-button"
            disabled={
              busy ||
              !status?.available ||
              status.state === 'running' ||
              status.state === 'starting'
            }
            onClick={() => void control('start')}
          >
            Запустить
          </button>
          <button
            className="secondary-button"
            disabled={busy || status?.state !== 'running' || !!status.activeSessions}
            onClick={() => void control('stop')}
          >
            Остановить
          </button>
        </div>
      )}
      {error && <p className="error-message">{error}</p>}
    </section>
  )
}
