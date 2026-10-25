import { useEffect, useRef, useState } from 'react'
import { Folder, File, Link, CornerLeftUp } from 'lucide-react'
import type { FileEntry, FileActivity } from '../../../../shared/contracts'
export function FileList({
  entries,
  selected,
  onSelect,
  onOpen,
  onParent,
  onBeginExternalDrag,
  nativeDrag = false,
  dragOwner,
  onMove,
  showPermissions = true,
  activities,
  onContextMenu,
}: {
  entries: FileEntry[]
  selected: string[]
  onSelect: (name: string, multiple: boolean) => void
  onOpen: (entry: FileEntry) => void
  onParent: () => void
  onBeginExternalDrag?: (entry: FileEntry) => boolean | string | Promise<boolean | string>
  nativeDrag?: boolean
  dragOwner?: string
  onMove?: (source: string, directory?: FileEntry) => void
  showPermissions?: boolean
  activities?: ReadonlyMap<string, FileActivity | undefined>
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void
}) {
  const dragging = useRef<FileEntry | undefined>(undefined)
  const nativeDragging = useRef<{ entry: FileEntry; path: string } | undefined>(undefined)
  useEffect(() => {
    nativeDragging.current = undefined
  }, [dragOwner])
  const table = useRef<HTMLTableElement>(null)
  useEffect(() => {
    const leave = (event: DragEvent) => {
      if (nativeDrag) return
      const entry = dragging.current
      if (!entry || !onBeginExternalDrag || entry.isSymlink || event.relatedTarget != null) return
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
      // Keep the entire in-window gesture in Chromium. Native OLE is only for drag-out.
      if (
        event.clientX > 0 &&
        event.clientY > 0 &&
        event.clientX < window.innerWidth &&
        event.clientY < window.innerHeight
      )
        return
      dragging.current = undefined
      void onBeginExternalDrag(entry)
    }
    const stop = () => {
      dragging.current = undefined
    }
    document.addEventListener('dragleave', leave)
    document.addEventListener('dragend', stop)
    document.addEventListener('drop', stop)
    return () => {
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('dragend', stop)
      document.removeEventListener('drop', stop)
    }
  }, [onBeginExternalDrag, nativeDrag])
  function accepts(event: React.DragEvent) {
    const types = Array.from(event.dataTransfer.types)
    return (
      !!onMove &&
      (types.includes('application/x-termlume-file') ||
        (!!nativeDragging.current && types.includes('Files')))
    )
  }
  function drop(event: React.DragEvent, directory?: FileEntry) {
    if (!accepts(event)) return
    const origin = nativeDragging.current
    const nativeMatch =
      origin &&
      Array.from(event.dataTransfer.files || []).some(
        (file) => window.terminalApi.files.getPathForFile(file) === origin.path,
      )
    if (
      !nativeMatch &&
      !Array.from(event.dataTransfer.types).includes('application/x-termlume-file')
    )
      return
    event.preventDefault()
    event.stopPropagation()
    dragging.current = undefined
    try {
      if (origin && nativeMatch) {
        nativeDragging.current = undefined
        onMove?.(origin.entry.name, directory)
        return
      }
      const payload = JSON.parse(event.dataTransfer.getData('application/x-termlume-file'))
      if (
        payload.owner === dragOwner &&
        typeof payload.name === 'string' &&
        entries.some((entry) => entry.name === payload.name && !entry.isSymlink)
      )
        onMove?.(payload.name, directory)
    } catch {
      /* Ignore unrelated or malformed drag data. */
    }
  }
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
    const next = columns[columns.findIndex((column) => column.key === key) + 1]
    if (!next) return
    setWidths((current) => {
      const combined = current[key] + current[next.key]
      const width = Math.max(min, Math.min(combined - next.min, value))
      return { ...current, [key]: width, [next.key]: combined - width }
    })
  }
  const totalWidth = columns.reduce((sum, column) => sum + widths[column.key], 0)
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
      <table ref={table} className={'file-table ' + (showPermissions ? 'with-permissions' : '')}>
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.key}
              style={{ width: `${(widths[column.key] / totalWidth) * 100}%` }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                aria-sort={
                  sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'
                }
              >
                <button
                  className="file-sort"
                  title={column.label}
                  aria-label={column.label}
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
                {index < columns.length - 1 && (
                  <span
                    className="file-column-resize"
                    role="separator"
                    tabIndex={0}
                    aria-label={`Ширина: ${column.label}`}
                    aria-orientation="vertical"
                    aria-valuemin={column.min}
                    aria-valuemax={
                      widths[column.key] + widths[columns[index + 1].key] - columns[index + 1].min
                    }
                    aria-valuenow={widths[column.key]}
                    aria-valuetext={`${Math.round((widths[column.key] / totalWidth) * 100)}% ширины таблицы`}
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
                        width = widths[column.key],
                        scale = totalWidth / (table.current?.clientWidth || totalWidth)
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                      const move = (next: PointerEvent) =>
                        resize(column.key, width + (next.clientX - start) * scale, column.min)
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
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr
            className={'parent-row ' + (selected.includes('..') ? 'selected' : '')}
            onDoubleClick={onParent}
            onClick={() => onSelect('..', false)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onParent()
            }}
          >
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
              draggable={
                !!dragOwner &&
                !entry.isSymlink &&
                (entry.type === 'file' || entry.type === 'directory')
              }
              onDragStart={(event) => {
                if (!dragOwner || entry.isSymlink) {
                  event.preventDefault()
                  return
                }
                dragging.current = entry
                if (nativeDrag && onBeginExternalDrag) {
                  event.preventDefault()
                  nativeDragging.current = undefined
                  void Promise.resolve(onBeginExternalDrag(entry)).then((path) => {
                    if (typeof path === 'string') nativeDragging.current = { entry, path }
                  })
                  return
                }
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(
                  'application/x-termlume-file',
                  JSON.stringify({ owner: dragOwner, name: entry.name }),
                )
              }}
              onDragOver={(event) => {
                if (entry.type === 'directory' && !entry.isSymlink && accepts(event)) {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(
                    'Files',
                  )
                    ? 'copy'
                    : 'move'
                }
              }}
              onDrop={(event) => {
                if (entry.type === 'directory' && !entry.isSymlink) drop(event, entry)
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
              <td
                title={
                  entry.type === 'directory'
                    ? 'Папка'
                    : `${entry.size.toLocaleString('ru-RU')} байт`
                }
              >
                {entry.type === 'directory'
                  ? '—'
                  : entry.size < 1024
                    ? entry.size + ' B'
                    : entry.size < 1048576
                      ? (entry.size / 1024).toFixed(1) + ' KB'
                      : (entry.size / 1048576).toFixed(1) + ' MB'}
              </td>
              <td title={new Date(entry.modifiedAt).toLocaleString('ru-RU')}>
                {new Date(entry.modifiedAt).toLocaleDateString('ru-RU')}
              </td>
              {showPermissions && (
                <>
                  <td title={entry.owner}>{entry.owner || '—'}</td>
                  <td title={entry.group}>{entry.group || '—'}</td>
                  <td
                    title={
                      entry.permissions === undefined
                        ? undefined
                        : formatPermissions(entry.permissions)
                    }
                  >
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
