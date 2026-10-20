import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../../shared/contracts'

export function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const api = window.terminalApi.updates
    if (!api) return
    let live = true
    let changed = false
    const off = api.onStatus((value) => {
      changed = true
      if (live) setStatus(value)
    })
    api
      .status()
      .then((value) => {
        if (live && !changed) setStatus(value)
      })
      .catch(() => {})
    return () => {
      live = false
      off()
    }
  }, [])
  if (!status || !['available', 'downloading', 'downloaded', 'installing'].includes(status.state))
    return null
  async function act(action: 'download' | 'install') {
    setPending(true)
    setError('')
    try {
      await window.terminalApi.updates[action]()
    } catch {
      setError('Не удалось выполнить обновление. Повторите в настройках.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="update-notice" role="status">
      <span>
        {status.state === 'available'
          ? `Доступно обновление ${status.version}`
          : status.state === 'downloading'
            ? `Загрузка обновления: ${Math.floor(status.percent || 0)}%`
            : status.state === 'downloaded'
              ? `Обновление ${status.version} готово`
              : 'Установка обновления…'}
      </span>
      {status.state === 'downloading' && (
        <progress max={100} value={status.percent || 0} aria-label="Загрузка обновления" />
      )}
      {status.state === 'available' && (
        <button disabled={pending} onClick={() => void act('download')}>
          Скачать
        </button>
      )}
      {status.state === 'downloaded' && (
        <button disabled={pending} onClick={() => void act('install')}>
          Перезапустить и установить
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
