import { useEffect, useState } from 'react'
import type { MetricSnapshot } from '../../../../shared/contracts'
export function useMonitoring(sessionId: string | undefined, enabled: boolean, visible: boolean) {
  const [snapshot, setSnapshot] = useState<MetricSnapshot>(),
    [error, setError] = useState('')
  useEffect(() => {
    setSnapshot(undefined)
    setError('')
    if (!sessionId || !enabled || !visible) return
    let live = true
    const off = window.terminalApi.monitoring.onSnapshot((event) => {
      if (live && event.sessionId === sessionId) setSnapshot(event.snapshot)
    })
    const update = () => {
      window.terminalApi.monitoring
        .setVisible(sessionId, document.visibilityState !== 'hidden')
        .catch((error) => {
          if (live) setError(String(error))
        })
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      live = false
      off()
      document.removeEventListener('visibilitychange', update)
      window.terminalApi.monitoring.setVisible(sessionId, false).catch(() => {})
    }
  }, [sessionId, enabled, visible])
  return {
    snapshot,
    error,
    retry: () => {
      if (sessionId)
        window.terminalApi.monitoring.retry(sessionId).catch((error) => setError(String(error)))
    },
  }
}
