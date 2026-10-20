import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { SessionEvent, AuthAnswer } from '../../../../shared/contracts'
export function AuthDialog({
  event,
  onAnswer,
  onCancel,
  protocol = 'ssh',
}: {
  protocol?: string
  event: Extract<SessionEvent, { type: 'challenge' }>
  onAnswer: (answer: AuthAnswer) => Promise<void>
  onCancel: () => void
}) {
  const [secret, setSecret] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const key = event.challenge.authType === 'key'
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-label={'Аутентификация ' + protocol.toUpperCase()}
        onSubmit={async (form) => {
          form.preventDefault()
          setBusy(true)
          try {
            await onAnswer({
              kind: 'auth',
              password: key ? undefined : secret,
              passphrase: key ? secret : undefined,
              remember: true,
            })
          } catch (error) {
            setError(String(error))
            setBusy(false)
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              {protocol.toUpperCase()} / {event.challenge.host}
            </span>
            <h2>Аутентификация</h2>
          </div>
          <KeyRound size={25} />
        </div>
        <label>
          {key ? 'Passphrase ключа' : 'Пароль'}
          <input
            autoFocus
            required
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
          />
        </label>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Отмена
          </button>
          <button className="primary-button" disabled={busy}>
            Подключиться
          </button>
        </div>
      </form>
    </div>
  )
}
