import { useEffect, useState } from 'react'
import { Circle, Square } from 'lucide-react'
export function SessionRecordingButton({
  sessionId,
  onError,
}: {
  sessionId: string
  onError: (message: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    setRecording(false)
    const refresh = () =>
      window.terminalApi.logs
        .list()
        .then((entries) => {
          if (alive)
            setRecording(entries.some((entry) => entry.active && entry.sessionId === sessionId))
        })
        .catch(() => {})
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId])
  const label = recording ? 'Остановить запись журнала сеанса' : 'Записывать журнал сеанса'
  return (
    <button
      className="session-recording-button"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={recording}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await window.terminalApi.logs[recording ? 'stop' : 'start'](sessionId)
          setRecording(!recording)
        } catch (error) {
          onError(String(error))
        } finally {
          setBusy(false)
        }
      }}
    >
      {recording ? <Square size={10} fill="currentColor" /> : <Circle size={10} />}
      {recording ? 'Запись' : 'Журнал'}
    </button>
  )
}
