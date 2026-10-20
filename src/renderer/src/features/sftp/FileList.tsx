import { useState } from 'react'
import { Folder, File, Link, CornerLeftUp } from 'lucide-react'
import type { FileEntry, FileActivity } from '../../../../shared/contracts'
export function FileList({
  entries,
  selected,
  onSelect,
  onOpen,
  onParent,
  onBeginExternalDrag,
  showPermissions = true,
  activities,
  onContextMenu,
}: {
  entries: FileEntry[]
  selected: string[]
  onSelect: (name: string, multiple: boolean) => void
  onOpen: (entry: FileEntry) => void
  onParent: () => void
  onBeginExternalDrag?: (entry: FileEntry) => boolean | Promise<boolean>
  showPermissions?: boolean
  activities?: ReadonlyMap<string, FileActivity | undefined>
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void
}) {
  type Column = 'name' | 'size' | 'modifiedAt' | 'permissions' | 'owner' | 'group'
  const columns: { key: Column; label: string; min: number }[] = [
    { key: 'name', label: 'Имя', min: 120 },
    { key: 'size', label: 'Размер', min: 65 },
    { key: 'modifiedAt', label: 'Изменён', min: 85 },
    ...(showPermissions
      ? [
          { key: 'owner' as const, label: 'Владелец', min: 80 },
          { key: 'group' as const, label: 'Группа', min: 80 },
          { key: 'permissions' as const, label: 'Доступ', min: 145 },
        ]
      : []),
  ]
  const [sort, setSort] = useState<{ key: Column; descending: boolean }>({
    key: 'name',
    descending: false,
  })
  const [widths, setWidths] = useState<Record<string, number>>({
    name: 180,
    size: 75,
    modifiedAt: 95,
    permissions: 160,
    owner: 90,
    group: 90,
  })
  function resize(key: Column, value: number, min: number) {
    setWidths((current) => ({ ...current, [key]: Math.max(min, Math.min(1000, value)) }))
  }
  const sorted = [...entries].sort((a, b) => {
    const folders = Number(b.type === 'directory') - Number(a.type === 'directory')
    if (folders) return folders
    const compared =
      sort.key === 'name' || sort.key === 'owner' || sort.key === 'group'
        ? String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        : (a[sort.key] ?? -1) - (b[sort.key] ?? -1)
    return (sort.descending ? -compared : compared) || a.name.localeCompare(b.name)
  })
  return (
    <div className="file-table-wrap">
      <table
        className={'file-table ' + (showPermissions ? 'with-permissions' : '')}
        style={{ minWidth: columns.reduce((sum, column) => sum + widths[column.key], 0) }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: widths[column.key] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                aria-sort={
                  sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'
                }
              >
                <button
                  className="file-sort"
                  onClick={() =>
                    setSort((current) => ({
                      key: column.key,
                      descending: current.key === column.key && !current.descending,
                    }))
                  }
                >
                  {column.label}
                  {sort.key === column.key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                </button>
                <span
                  className="file-column-resize"
                  role="separator"
                  tabIndex={0}
                  aria-label={`Ширина: ${column.label}`}
                  aria-orientation="vertical"
                  aria-valuemin={column.min}
                  aria-valuemax={1000}
                  aria-valuenow={widths[column.key]}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault()
                      resize(
                        column.key,
                        widths[column.key] + (event.key === 'ArrowRight' ? 10 : -10),
                        column.min,
                      )
                    }
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    const start = event.clientX,
                      width = widths[column.key]
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    const move = (next: PointerEvent) =>
                      resize(column.key, width + next.clientX - start, column.min)
                    const stop = () => {
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', stop)
                      window.removeEventListener('pointercancel', stop)
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', stop)
                    window.addEventListener('pointercancel', stop)
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="parent-row" onDoubleClick={onParent} onClick={onParent}>
            <td>
              <CornerLeftUp size={13} />
              ..
            </td>
            <td />
            <td />
            {showPermissions && (
              <>
                <td />
                <td />
                <td />
              </>
            )}
          </tr>
          {sorted.map((entry) => (
            <tr
              key={entry.name}
              data-name={entry.name}
              className={
                (selected.includes(entry.name) ? 'selected ' : '') +
                (activities?.get(entry.name) ? 'file-working' : '')
              }
              draggable={!!onBeginExternalDrag && entry.type === 'file' && !entry.isSymlink}
              onDragStart={(event) => {
                event.preventDefault()
                if (entry.type === 'file' && !entry.isSymlink) onBeginExternalDrag?.(entry)
              }}
              onClick={(event) => onSelect(entry.name, event.ctrlKey || event.metaKey)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(event) => {
                if (!onContextMenu) return
                event.preventDefault()
                if (!selected.includes(entry.name)) onSelect(entry.name, false)
                onContextMenu(entry, event.clientX, event.clientY)
              }}
              tabIndex={0}
              onKeyDown={(event) => {
                if (
                  onContextMenu &&
                  (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
                ) {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  if (!selected.includes(entry.name)) onSelect(entry.name, false)
                  onContextMenu(entry, rect.left + 20, rect.bottom)
                }
                if (event.key === 'Enter') onOpen(entry)
                if (event.key === ' ') {
                  event.preventDefault()
                  onSelect(entry.name, event.ctrlKey)
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const next =
                    event.key === 'ArrowDown'
                      ? event.currentTarget.nextElementSibling
                      : event.currentTarget.previousElementSibling
                  if (next instanceof HTMLElement && next.tabIndex >= 0) {
                    next.focus()
                    onSelect(next.dataset.name || entry.name, false)
                  }
                }
              }}
            >
              <td title={entry.name}>
                {entry.isSymlink ? (
                  <Link size={13} />
                ) : entry.type === 'directory' ? (
                  <Folder size={14} className="folder-icon" />
                ) : (
                  <File size={13} />
                )}
                <div className="file-name-cell">
                  <span>{entry.name}</span>
                  {activities?.get(entry.name) && (
                    <FileProgress entry={entry} activity={activities.get(entry.name)!} />
                  )}
                </div>
              </td>
              <td>
                {entry.type === 'directory'
                  ? '—'
                  : entry.size < 1024
                    ? entry.size + ' B'
                    : entry.size < 1048576
                      ? (entry.size / 1024).toFixed(1) + ' KB'
                      : (entry.size / 1048576).toFixed(1) + ' MB'}
              </td>
              <td>{new Date(entry.modifiedAt).toLocaleDateString('ru-RU')}</td>
              {showPermissions && (
                <>
                  <td title={entry.owner}>{entry.owner || '—'}</td>
                  <td title={entry.group}>{entry.group || '—'}</td>
                  <td>
                    {entry.permissions === undefined ? '—' : formatPermissions(entry.permissions)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length && <p className="empty-result">Папка пуста</p>}
    </div>
  )
}

function FileProgress({ entry, activity }: { entry: FileEntry; activity: FileActivity }) {
  const total = activity.total && activity.total > 0 ? activity.total : undefined
  const completed = Math.max(0, activity.completed)
  const opening = activity.kind === 'open' && total !== undefined && completed >= total
  const label = opening
    ? 'Открытие…'
    : activity.kind === 'save'
      ? 'Сохранение…'
      : activity.kind === 'download'
        ? 'Перенос…'
        : 'Загрузка…'
  const percentage =
    total && !opening ? ` ${Math.min(100, Math.floor((completed / total) * 100))}%` : ''
  return (
    <div className="file-activity" role="status">
      <span>{label + percentage}</span>
      <progress
        aria-label={`${label} ${entry.name}`}
        max={total}
        value={total === undefined ? undefined : Math.min(completed, total)}
      />
    </div>
  )
}

export function formatPermissions(mode: number) {
  const permissionBits = mode & 0o777,
    userExecute = permissionBits & 0o100 ? 'x' : '-',
    groupExecute = permissionBits & 0o010 ? 'x' : '-',
    otherExecute = permissionBits & 0o001 ? 'x' : '-',
    userSpecial = mode & 0o4000 ? (userExecute === 'x' ? 's' : 'S') : userExecute,
    groupSpecial = mode & 0o2000 ? (groupExecute === 'x' ? 's' : 'S') : groupExecute,
    otherSpecial = mode & 0o1000 ? (otherExecute === 'x' ? 't' : 'T') : otherExecute,
    symbolic = [
      permissionBits & 0o400 ? 'r' : '-',
      permissionBits & 0o200 ? 'w' : '-',
      userSpecial,
      permissionBits & 0o040 ? 'r' : '-',
      permissionBits & 0o020 ? 'w' : '-',
      groupSpecial,
      permissionBits & 0o004 ? 'r' : '-',
      permissionBits & 0o002 ? 'w' : '-',
      otherSpecial,
    ].join('')
  return `${mode.toString(8).padStart(4, '0')} · ${symbolic}`
}
