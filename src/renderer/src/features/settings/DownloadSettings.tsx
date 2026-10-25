import { useState } from 'react'
import type { Settings } from '../../../../shared/contracts'
export function DownloadSettings({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: (value: Settings) => void
}) {
  const [error, setError] = useState('')
  async function update(patch: Partial<Settings>) {
    try {
      onSaved(await window.terminalApi.settings.update(patch))
      setError('')
    } catch (error) {
      setError(String(error))
    }
  }
  return (
    <section className="settings-section">
      <h3>Скачивание файлов</h3>
      <p className="muted small">Папка назначения: {settings.downloadDirectory || 'Загрузки'}</p>
      <button
        className="secondary-button"
        onClick={async () => {
          try {
            const directory = await window.terminalApi.files.downloadDestination(true)
            if (directory) await update({ downloadDirectory: directory })
          } catch (error) {
            setError(String(error))
          }
        }}
      >
        Выбрать папку…
      </button>
      <label>
        <input
          type="checkbox"
          checked={settings.askDownloadDirectory ?? false}
          onChange={(event) => void update({ askDownloadDirectory: event.target.checked })}
        />
        Спрашивать папку при каждом скачивании
      </label>
      {error && <p className="error-message">{error}</p>}
      <label>
        <input
          type="checkbox"
          checked={settings.followTerminalDirectory ?? true}
          onChange={(event) => void update({ followTerminalDirectory: event.target.checked })}
        />
        Следовать за папкой терминала
      </label>
    </section>
  )
}
