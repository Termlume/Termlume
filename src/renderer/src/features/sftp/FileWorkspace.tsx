import { useState } from 'react'
import { FolderSync } from 'lucide-react'
import type { SessionState } from '../../../../shared/contracts'
import { SftpBrowser } from './Browser'
import { Transfers } from './Transfers'
import { enqueueSelection } from './enqueue-selection'

export function FileWorkspace({
  sessionId,
  state,
  name,
  protocol,
  active,
}: {
  active: boolean
  sessionId: string
  state: SessionState
  name: string
  protocol: string
}) {
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  return (
    <section className="file-workspace" aria-label={`Файловый клиент: ${name}`}>
      <div className="file-workspace-heading">
        <FolderSync size={16} /> <strong>{name}</strong>
        <span>{protocol.toUpperCase()}</span>
        {state !== 'connected' && (
          <span role="status">
            {state === 'error' || state === 'disconnected' ? 'Нет соединения' : 'Подключение…'}
          </span>
        )}
      </div>
      <SftpBrowser
        sessionId={state === 'connected' ? sessionId : undefined}
        mode="two-panel"
        terminalAvailable={false}
        active={active}
        refreshToken={revision}
        unsupportedReason={
          state === 'connected' ? undefined : 'Ожидание подключения к файловому серверу…'
        }
        onTransfer={(direction, source, target, entries) => {
          setError('')
          void enqueueSelection(sessionId, direction, source, target, entries).catch((error) =>
            setError(String(error)),
          )
        }}
      />
      {error && (
        <div className="file-inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')}>ОК</button>
        </div>
      )}
      <Transfers
        compact
        sessionId={sessionId}
        onFinished={() => setRevision((value) => value + 1)}
      />
    </section>
  )
}
