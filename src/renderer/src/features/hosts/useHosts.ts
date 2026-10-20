import { useCallback, useEffect, useState } from 'react'
import type { HostProfile } from '../../../../shared/contracts'
export function filterHosts(hosts: HostProfile[], query: string, favorites: boolean) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return hosts.filter((host) => {
    if (favorites && !host.favorite) return false
    const tags = (host.tags || []).map((tag) => tag.toLocaleLowerCase())
    const values = [
      host.name,
      host.group,
      host.protocol === 'wsl' ? host.distribution : host.host,
      ...tags,
    ]
    return terms.every((term) =>
      term.startsWith('#')
        ? tags.includes(term.slice(1))
        : values.some((value) => value.toLocaleLowerCase().includes(term)),
    )
  })
}
export function useHosts(onError: (message: string) => void) {
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const refresh = useCallback(async () => setHosts(await window.terminalApi.hosts.list()), [])
  useEffect(() => {
    refresh().catch((error) => onError(String(error)))
  }, [refresh])
  async function save(profile: HostProfile) {
    await window.terminalApi.hosts.save(profile)
    await refresh()
  }
  async function remove(id: string) {
    await window.terminalApi.hosts.remove(id)
    await refresh()
  }
  return { hosts, refresh, save, remove }
}
