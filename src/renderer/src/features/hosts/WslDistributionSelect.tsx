import { useEffect, useRef, useState } from 'react'
import type { WslDistribution } from '../../../../shared/contracts'

export function WslDistributionSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (name: string) => void
}) {
  const [items, setItems] = useState<WslDistribution[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    window.terminalApi.wsl
      .inventory()
      .then((result) => {
        if (!active) return
        setItems(result)
        if (!value) onChange(result.find((item) => item.isDefault)?.name || result[0]?.name || '')
      })
      .catch((reason) => {
        if (active) setError(reason.message || 'Не удалось получить список WSL')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision])
  const missing = !!value && !items.some((item) => item.name === value)
  useEffect(() => {
    select.current?.setCustomValidity(
      loading
        ? 'Дождитесь загрузки списка WSL'
        : error || (missing ? 'Выберите установленный дистрибутив WSL' : ''),
    )
  }, [loading, error, missing])
  return (
    <div>
      <label>
        Дистрибутив WSL
        <select
          ref={select}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{loading ? 'Загрузка…' : 'Выберите дистрибутив'}</option>
          {missing && (
            <option value={value} disabled>
              {value} — не установлен
            </option>
          )}
          {items.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
              {item.isDefault ? ' (по умолчанию)' : ''} · WSL {item.version} · {item.state}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={loading}
        onClick={() => setRevision((current) => current + 1)}
      >
        Обновить список WSL
      </button>
      {!loading && !error && !items.length && <p role="alert">Дистрибутивы WSL не установлены.</p>}
      {!loading && missing && !error && (
        <p role="alert">Выбранный дистрибутив больше не установлен. Выберите другой.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
