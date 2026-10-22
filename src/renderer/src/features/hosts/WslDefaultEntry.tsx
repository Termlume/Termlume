import { useEffect, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { HostProfile } from '../../../../shared/contracts'

export function WslDefaultEntry({
  hosts,
  search,
  favoriteOnly,
  onConnect,
}: {
  hosts: HostProfile[]
  search: string
  favoriteOnly: boolean
  onConnect: (profile: HostProfile) => void
}) {
  const [distribution, setDistribution] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = () =>
      window.terminalApi.wsl
        .inventory()
        .then((items) => {
          if (alive) setDistribution(items.find((item) => item.isDefault)?.name ?? '')
        })
        .catch(() => {})
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  if (
    !distribution ||
    favoriteOnly ||
    hosts.some((host) => host.protocol === 'wsl' && host.distribution === distribution) ||
    !`${distribution} wsl`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
    return null
  return (
    <div className="host-row">
      <button
        className="host-connect"
        aria-label={`Подключиться: ${distribution}`}
        onClick={() =>
          onConnect({
            id: crypto.randomUUID(),
            name: distribution,
            protocol: 'wsl',
            distribution,
            favorite: false,
            group: '',
          })
        }
      >
        <span className="host-symbol">
          <TerminalSquare size={18} />
        </span>
        <span>
          <strong>{distribution}</strong>
          <small>Основной дистрибутив</small>
        </span>
        <span className="protocol-tag">WSL</span>
      </button>
    </div>
  )
}
