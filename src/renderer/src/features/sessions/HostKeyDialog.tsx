import { useState } from 'react'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import type { SessionEvent, TrustAnswer } from '../../../../shared/contracts'
export function HostKeyDialog({
  event,
  onAnswer,
}: {
  event: Extract<SessionEvent, { type: 'challenge' }>
  onAnswer: (answer: TrustAnswer) => Promise<void>
}) {
  const [error, setError] = useState(''),
    [replace, setReplace] = useState(false),
    [busy, setBusy] = useState(false),
    c = event.challenge
  async function answer(accept: boolean) {
    setBusy(true)
    try {
      await onAnswer({ kind: 'trust', accept, replaceExisting: replace })
    } catch (error) {
      setError(String(error))
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-label="Проверка ключа сервера">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ДОВЕРИЕ СЕРВЕРУ</span>
            <h2>{c.changed ? 'Ключ сервера изменился' : 'Первое подключение'}</h2>
          </div>
          {c.changed ? (
            <ShieldAlert size={27} color="var(--red)" />
          ) : (
            <ShieldCheck size={27} color="var(--accent)" />
          )}
        </div>
        <p className="muted small">
          Проверьте отпечаток ключа сервера через доверенный источник перед подключением.
        </p>
        <dl className="key-details">
          <dt>Сервер</dt>
          <dd>{c.host}</dd>
          <dt>Алгоритм</dt>
          <dd>{c.algorithm}</dd>
          <dt>SHA-256</dt>
          <dd>{c.fingerprint}</dd>
        </dl>
        {c.changed && (
          <>
            <p className="error-message">
              Сохранённый ключ не совпадает с полученным. Подключение заблокировано до вашего
              решения.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
              />
              Я проверил новый ключ и разрешаю заменить сохранённый
            </label>
          </>
        )}
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" disabled={busy} onClick={() => answer(false)}>
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={busy || (c.changed && !replace)}
            onClick={() => answer(true)}
          >
            Доверять и подключиться
          </button>
        </div>
      </section>
    </div>
  )
}
