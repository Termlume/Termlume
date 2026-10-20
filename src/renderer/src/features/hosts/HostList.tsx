import './hosts.css'
import {
  Server,
  TerminalSquare,
  Star,
  Pencil,
  Trash2,
  ChevronRight,
  GripVertical,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { orderedGroups } from './group-order'
import type { HostProfile } from '../../../../shared/contracts'
export function HostList({
  hosts,
  onConnect,
  onEdit,
  onRemove,
  onFavorite,
  onTag,
  collapsedGroups = [],
  onToggleGroup,
  searchActive = false,
  groupOrder = [],
  onReorderGroup,
}: {
  groupOrder?: string[]
  onReorderGroup?: (source: string, target: string, position: 'before' | 'after') => void
  collapsedGroups?: string[]
  onToggleGroup?: (group: string) => void
  searchActive?: boolean
  onTag?: (tag: string) => void
  hosts: HostProfile[]
  onConnect: (profile: HostProfile) => void
  onEdit: (profile: HostProfile) => void
  onRemove: (profile: HostProfile) => void
  onFavorite: (profile: HostProfile) => void
}) {
  const dragged = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    group: string
    position: 'before' | 'after'
  } | null>(null)
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null)
  if (!hosts.length) return <p className="empty-result">Подключения не найдены</p>
  const groups = orderedGroups(
    hosts.map((host) => host.group || ''),
    groupOrder,
  )
  const dragType = 'application/x-termlume-host-group'
  function stopDrag() {
    dragged.current = null
    setDraggedGroup(null)
    setDropTarget(null)
  }
  return (
    <>
      {groups.map((group) => (
        <div
          className={
            'host-group' +
            (draggedGroup === group ? ' group-dragging' : '') +
            (dropTarget?.group === group ? ` drop-${dropTarget.position}` : '')
          }
          data-group={group}
          key={group}
          onDragOver={(event) => {
            if (
              !onReorderGroup ||
              dragged.current === null ||
              dragged.current === group ||
              !Array.from(event.dataTransfer.types).includes(dragType)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            setDropTarget((current) =>
              current?.group === group && current.position === position
                ? current
                : { group, position },
            )
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setDropTarget(null)
          }}
          onDrop={(event) => {
            if (
              !onReorderGroup ||
              dragged.current === null ||
              !Array.from(event.dataTransfer.types).includes(dragType)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            const source = dragged.current
            const rect = event.currentTarget.getBoundingClientRect()
            const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            if (event.dataTransfer.getData(dragType) === source && source !== group)
              onReorderGroup(source, group, position)
            stopDrag()
          }}
        >
          <button
            type="button"
            className="host-group-title"
            draggable={!!onReorderGroup}
            title={onReorderGroup ? 'Перетащите группу вверх или вниз · Alt+↑/↓' : undefined}
            onDragStart={(event) => {
              if (!onReorderGroup) return
              dragged.current = group
              setDraggedGroup(group)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(dragType, group)
            }}
            onDragEnd={stopDrag}
            onKeyDown={(event) => {
              if (!onReorderGroup || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
                return
              event.preventDefault()
              const direction = event.key === 'ArrowUp' ? -1 : 1
              const target = groups[groups.indexOf(group) + direction]
              if (target !== undefined)
                onReorderGroup(group, target, direction < 0 ? 'before' : 'after')
            }}
            aria-expanded={searchActive || !collapsedGroups.includes(group)}
            onClick={() => {
              if (!searchActive) onToggleGroup?.(group)
            }}
          >
            {onReorderGroup && <GripVertical size={12} className="group-drag-handle" />}
            <ChevronRight
              size={11}
              style={{
                transform:
                  searchActive || !collapsedGroups.includes(group) ? 'rotate(90deg)' : undefined,
              }}
            />
            {group || 'Без группы'}
            <span>{hosts.filter((host) => (host.group || '') === group).length}</span>
          </button>
          {(searchActive || !collapsedGroups.includes(group)) &&
            hosts
              .filter((host) => (host.group || '') === group)
              .map((host) => (
                <div className="host-row" key={host.id}>
                  <button
                    className="host-connect"
                    onClick={() => onConnect(host)}
                    aria-label={'Подключиться: ' + host.name}
                  >
                    <span className="host-symbol" style={{ color: host.color }}>
                      {host.protocol === 'wsl' ? (
                        <TerminalSquare size={18} />
                      ) : (
                        <Server size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{host.name}</strong>
                      <small>{host.protocol === 'wsl' ? host.distribution : host.host}</small>
                    </span>
                    <span className="protocol-tag">{host.protocol.toUpperCase()}</span>
                  </button>
                  {!!host.tags?.length && (
                    <div className="host-tags">
                      {host.tags.map((tag) => (
                        <button
                          type="button"
                          className="host-tag"
                          key={tag}
                          onClick={(event) => {
                            event.stopPropagation()
                            onTag?.(tag)
                          }}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
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
