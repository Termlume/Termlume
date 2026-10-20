import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { Settings, UpdateStatus } from '../../../../shared/contracts'
import './updates.css'

export function Updates({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: (settings: Settings) => void
}) {
  const [status, setStatus] = useState<UpdateStatus>()
  const [channel, setChannel] = useState(settings.updateChannel ?? 'prerelease')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const api = window.terminalApi.updates
    if (!api) return
    let revision = 0
    const unsubscribe = api.onStatus((next) => {
      revision++
      if (mounted.current) setStatus(next)
    })
    const initialRevision = revision
    api
      .status()
      .then((next) => {
        if (mounted.current && revision === initialRevision) setStatus(next)
      })
      .catch(() => {
        if (mounted.current)
          setError(
            'Не удалось получить состояние обновлений. Попробуйте открыть настройки ещё раз.',
          )
      })
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])
  useEffect(() => setChannel(settings.updateChannel ?? 'prerelease'), [settings.updateChannel])
  const busy =
    pending ||
    status?.state === 'checking' ||
    status?.state === 'downloading' ||
    status?.state === 'installing'
  const disabled = !window.terminalApi.updates || status?.state === 'disabled'
  async function run(action: 'check' | 'download' | 'install') {
    if (busy || disabled) return
    setPending(true)
    setError('')
    try {
      const result = await window.terminalApi.updates[action]()
      if (mounted.current && result) setStatus(result)
    } catch {
      if (mounted.current)
        setError(
          action === 'check'
            ? 'Не удалось проверить обновления. Проверьте подключение и повторите.'
            : action === 'download'
              ? 'Не удалось скачать обновление. Повторите загрузку.'
              : 'Не удалось запустить установку обновления.',
        )
    } finally {
      if (mounted.current) setPending(false)
    }
  }
  async function changeChannel(next: 'stable' | 'prerelease') {
    setPending(true)
    setError('')
    try {
      const saved = await window.terminalApi.settings.update({ updateChannel: next })
      if (mounted.current) {
        setChannel(saved.updateChannel ?? next)
        onSaved(saved)
        void window.terminalApi.updates
          .status()
          .then((next) => {
            if (mounted.current) setStatus(next)
          })
          .catch(() => {})
      }
    } catch {
      if (mounted.current) setError('Не удалось сохранить канал обновлений. Повторите попытку.')
    } finally {
      if (mounted.current) setPending(false)
    }
  }
  const percent = Math.min(100, Math.max(0, status?.percent ?? 0))
  const stateLabel = !status
    ? 'Получение состояния обновлений…'
    : status.state === 'disabled'
      ? status.message || 'Обновления доступны в установленной версии приложения.'
      : status.state === 'checking'
        ? 'Проверяем наличие новой версии…'
        : status.state === 'available'
          ? `Доступна версия ${status.version ?? ''}`
          : status.state === 'not-available'
            ? 'Установлена актуальная версия для выбранного канала.'
            : status.state === 'downloading'
              ? `Загрузка обновления: ${Math.floor(percent)}%`
              : status.state === 'downloaded'
                ? `Версия ${status.version ?? ''} готова к установке.`
                : status.state === 'installing'
                  ? 'Запускаем установку…'
                  : status.state === 'error'
                    ? 'Не удалось обновить приложение. Повторите проверку.'
                    : 'Проверяйте наличие новых версий Termlume здесь.'
  return (
    <section className="updates-settings" aria-label="Обновления приложения">
      <div className="updates-heading">
        <h3>Обновления</h3>
        <span>{status ? `Установлена ${status.currentVersion}` : 'Termlume · alpha'}</span>
      </div>
      <label>
        Канал обновлений
        <select
          aria-label="Канал обновлений"
          value={channel}
          disabled={busy || disabled || !status}
          onChange={(event) => void changeChannel(event.target.value as 'stable' | 'prerelease')}
        >
          <option value="stable">Стабильные версии</option>
          <option value="prerelease">Предварительные версии</option>
        </select>
      </label>
      <p className="muted small">Проверяем обновления автоматически каждый час.</p>
      <p role="status">
        {!window.terminalApi.updates ? 'В этой сборке проверка обновлений недоступна.' : stateLabel}
      </p>
      {status?.state === 'downloading' && (
        <progress aria-label="Загрузка обновления" max={100} value={percent} />
      )}
      {(error || status?.state === 'error') && (
        <p className="error-message" role="alert">
          {error || 'Проверьте подключение к интернету и повторите проверку.'}
        </p>
      )}
      <div className="updates-actions">
        <button
          className="secondary-button"
          disabled={busy || disabled || !status}
          onClick={() => void run('check')}
        >
          <RefreshCw size={13} /> Проверить обновления
        </button>
        {status?.state === 'available' && (
          <button className="primary-button" disabled={busy} onClick={() => void run('download')}>
            <Download size={13} /> Скачать обновление
          </button>
        )}
        {status?.state === 'downloaded' && (
          <button className="primary-button" disabled={busy} onClick={() => void run('install')}>
            Перезапустить и установить
          </button>
        )}
      </div>
      <p className="updates-note">
        Предварительные версии содержат новые функции и могут быть менее стабильными. Обновление
        устанавливается только по вашей команде. Переход на другой канал не понижает установленную
        версию.
      </p>
    </section>
  )
}
