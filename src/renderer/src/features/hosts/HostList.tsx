import { Server, TerminalSquare, Star, Pencil, Trash2, ChevronRight } from 'lucide-react'
import type { HostProfile } from '../../../../shared/contracts'
export function HostList({
  hosts,
  onConnect,
  onEdit,
  onRemove,
  onFavorite,
}: {
  hosts: HostProfile[]
  onConnect: (profile: HostProfile) => void
  onEdit: (profile: HostProfile) => void
  onRemove: (profile: HostProfile) => void
  onFavorite: (profile: HostProfile) => void
}) {
  if (!hosts.length) return <p className="empty-result">Подключения не найдены</p>
  const groups = [...new Set(hosts.map((host) => host.group || 'Без группы'))]
  return (
    <>
      {groups.map((group) => (
        <div className="host-group" key={group}>
          <div className="host-group-title">
            <ChevronRight size={11} />
            {group}
            <span>{hosts.filter((host) => (host.group || 'Без группы') === group).length}</span>
          </div>
          {hosts
            .filter((host) => (host.group || 'Без группы') === group)
            .map((host) => (
              <div className="host-row" key={host.id}>
                <button
                  className="host-connect"
                  onClick={() => onConnect(host)}
                  aria-label={'Подключиться: ' + host.name}
                >
                  <span className="host-symbol" style={{ color: host.color }}>
                    {host.protocol === 'wsl' ? <TerminalSquare size={18} /> : <Server size={18} />}
                  </span>
                  <span>
                    <strong>{host.name}</strong>
                    <small>{host.protocol === 'wsl' ? host.distribution : host.host}</small>
                  </span>
                  <span className="protocol-tag">{host.protocol.toUpperCase()}</span>
                </button>
                <div className="host-actions">
                  <button
                    title="Избранное"
                    aria-label={'Избранное: ' + host.name}
                    onClick={() => onFavorite(host)}
                  >
                    <Star size={12} fill={host.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    title="Изменить"
                    aria-label={'Изменить: ' + host.name}
                    onClick={() => onEdit(host)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    title="Удалить"
                    aria-label={'Удалить: ' + host.name}
                    onClick={() => onRemove(host)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      ))}
    </>
  )
}
