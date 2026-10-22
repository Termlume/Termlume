import { useRef, useState } from 'react'
import type { HostProfile } from '../../../../shared/contracts'
import { DEFAULT_MONITOR_ITEMS, type MonitorItem } from '../../../../shared/monitoring-items'

export function useMonitorPreferences(
  profile: HostProfile | undefined,
  hosts: HostProfile[],
  defaults: MonitorItem[] | undefined,
  refresh: () => Promise<void>,
  onError: (message: string) => void,
) {
  const [overrides, setOverrides] = useState<Record<string, { items?: MonitorItem[] }>>({})
  const queue = useRef(Promise.resolve())
  const saved = hosts.find((host) => host.id === profile?.id)
  const stored = profile && overrides[profile.id]
  const items =
    (stored ? stored.items : (saved || profile)?.monitoringItems) ??
    defaults ??
    DEFAULT_MONITOR_ITEMS
  const change = (next?: MonitorItem[]) => {
    if (!profile) return
    const id = profile.id
    setOverrides((current) => ({ ...current, [id]: { items: next } }))
    // Quick connections keep their preference for this app session, without creating a profile.
    if (!saved) return
    queue.current = queue.current.then(async () => {
      try {
        // Merge with the latest saved profile so credential/editor changes are retained.
        const latest = (await window.terminalApi.hosts.list()).find((host) => host.id === id)
        if (!latest) return
        await window.terminalApi.hosts.save({ ...latest, monitoringItems: next })
        await refresh()
      } catch (error) {
        onError(`Не удалось сохранить показатели подключения: ${String(error)}`)
      }
    })
  }
  return { items, change, reset: () => change(undefined) }
}
