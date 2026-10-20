import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ArrowUpFromLine, Upload } from 'lucide-react'
import type {
  FileCapabilities,
  FileEntry,
  FileAccessMode,
  FileActivity,
} from '../../../../shared/contracts'
import { FileList, formatPermissions } from './FileList'
import { PathBar } from './PathBar'
import './files.css'
type Side = 'local' | 'remote'
export function SftpBrowser({
  sessionId,
  mode = 'remote-only',
  onTransfer,
  refreshToken = 0,
  unsupportedReason,
  localShell,
  terminalAvailable = true,
  active = true,
}: {
  sessionId?: string
  mode?: 'two-panel' | 'remote-only'
  refreshToken?: number
  unsupportedReason?: string
  localShell?: 'powershell' | 'cmd'
  active?: boolean
  terminalAvailable?: boolean
  onTransfer?: (
    direction: 'upload' | 'download',
    source: string,
    target: string,
    files: FileEntry[],
  ) => void
}) {
  const [requestedLocal, setRequestedLocal] = useState('')
  const [requestedRemote, setRequestedRemote] = useState('.')
  const [failedPaths, setFailedPaths] = useState<Partial<Record<Side, string>>>({})
  const [localPath, setLocalPath] = useState(''),
    [remotePath, setRemotePath] = useState('.'),
    [local, setLocal] = useState<FileEntry[]>([]),
    [remote, setRemote] = useState<FileEntry[]>([]),
    [remoteCapabilities, setRemoteCapabilities] = useState<FileCapabilities>(),
    [accessMode, setAccessMode] = useState<FileAccessMode>(),
    [filter, setFilter] = useState('')
  const [selectedLocal, setSelectedLocal] = useState<string[]>([]),
    [selectedRemote, setSelectedRemote] = useState<string[]>([]),
    [localError, setLocalError] = useState(''),
    [remoteError, setRemoteError] = useState(''),
    [revision, setRevision] = useState(0)
  const [action, setAction] = useState<{
      side: Side
      operation: 'mkdir' | 'rename' | 'remove' | 'chmod'
      entry?: FileEntry
    }>(),
    [name, setName] = useState(''),
    [owner, setOwner] = useState(''),
    [group, setGroup] = useState(''),
    [error, setError] = useState('')
  const [transferError, setTransferError] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)
  const [context, setContext] = useState<{ side: Side; entry: FileEntry; x: number; y: number }>()
  const [properties, setProperties] = useState<{ side: Side; entry: FileEntry }>()
  useEffect(() => {
    if (!active) {
      setContext(undefined)
      setAction(undefined)
      setProperties(undefined)
      setDraggingOver(false)
    }
  }, [active])
  const [activities, setActivities] = useState<Record<string, FileActivity>>({})
  const pendingOpens = useRef(new Set<string>())
  const dragOwner = useRef(crypto.randomUUID())
  const activeSession = useRef(sessionId)
  activeSession.current = sessionId
  const remotePaths = useRef(new Map<string, string>())
  function activityKey(value: string) {
    return /^(?:[a-z]:[\\/]|\\\\)/i.test(value) ? value.replaceAll('\\', '/') : value
  }
  useEffect(() => {
    setActivities({})
    return window.terminalApi.files.onActivity?.((activity) => {
      if (activity.sessionId !== sessionId) return
      const key = activityKey(activity.path)
      setActivities((current) => {
        const next = { ...current }
        if (activity.state === 'running') next[key] = activity
        else delete next[key]
        return next
      })
      if (activity.state === 'error' && activity.error) setTransferError(activity.error)
    })
  }, [sessionId])
  async function openFile(entry: FileEntry, mode: 'default' | 'choose' | 'text' = 'default') {
    if (!sessionId || entry.isSymlink) return
    const target = path('remote', entry.name)
    const key = activityKey(target)
    const pendingKey = sessionId + ':' + key
    if (pendingOpens.current.has(pendingKey)) return
    pendingOpens.current.add(pendingKey)
    setTransferError('')
    setActivities((current) => ({
      ...current,
      [key]: {
        sessionId,
        path: target,
        kind: 'open',
        state: 'running',
        completed: 0,
      },
    }))
    try {
      if (mode === 'default') await window.terminalApi.files.openRemote(sessionId, target)
      else await window.terminalApi.files.openRemote(sessionId, target, mode)
    } catch (error) {
      if (activeSession.current === sessionId) setTransferError(String(error))
    } finally {
      pendingOpens.current.delete(pendingKey)
      if (activeSession.current === sessionId)
        setActivities((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
    }
  }
  useEffect(() => {
    window.terminalApi.files
      .localRoot()
      .then(setRequestedLocal)
      .catch((error) => setLocalError(String(error)))
  }, [])
  useEffect(() => {
    const initial = sessionId ? remotePaths.current.get(sessionId) || '.' : '.'
    setRemotePath(initial)
    setRequestedRemote(initial)
    setRemote([])
    setRemoteCapabilities(undefined)
    setAccessMode(undefined)
    setFilter('')
    setSelectedRemote([])
    setRemoteError('')
    setAction(undefined)
    setContext(undefined)
    setProperties(undefined)
    setError('')
  }, [sessionId])
  useEffect(() => {
    if (!requestedLocal) return
    let live = true
    setSelectedLocal([])
    window.terminalApi.files
      .list({ side: 'local', path: requestedLocal })
      .then((result) => {
        if (live) {
          setLocalPath(result.path)
          setLocal(result.entries)
          setLocalError('')
        }
      })
      .catch((error) => {
        if (live) {
          setFailedPaths((current) => ({ ...current, local: requestedLocal }))
          setLocalError(String(error))
        }
      })
    return () => {
      live = false
    }
  }, [requestedLocal, revision, refreshToken])
  useEffect(() => {
    if (!sessionId) return
    let live = true
    setSelectedRemote([])
    window.terminalApi.files
      .list({ side: 'remote', path: requestedRemote, sessionId })
      .then((result) => {
        if (live) {
          setRemote(result.entries)
          setRemoteCapabilities(result.capabilities)
          setAccessMode(result.mode)
          setRemoteError('')
          remotePaths.current.set(sessionId, result.path)
          setRemotePath(result.path)
        }
      })
      .catch((error) => {
        if (live) {
          setFailedPaths((current) => ({ ...current, remote: requestedRemote }))
          setRemoteError(String(error))
        }
      })
    return () => {
      live = false
    }
  }, [sessionId, requestedRemote, revision, refreshToken])
  function path(side: Side, name?: string) {
    const base = side === 'local' ? localPath : remotePath
    const separator = side === 'local' || accessMode === 'local' || /^\\\\/.test(base) ? '\\' : '/'
    return name ? base.replace(/[\\/]$/, '') + separator + name : base
  }
  function navigate(side: Side, next: string) {
    setContext(undefined)
    if (side === 'local') setRequestedLocal(next)
    else setRequestedRemote(next)
  }
  function parent(side: Side) {
    const current = path(side)
    if (side === 'local' || accessMode === 'local')
      navigate(side, current.replace(/[\\/][^\\/]+[\\/]?$/, '') || current)
    else if (/^\\\\/.test(current)) {
      const parts = current.split('\\').filter(Boolean)
      navigate(side, parts.length <= 2 ? current : '\\\\' + parts.slice(0, -1).join('\\'))
    } else navigate(side, current === '/' ? '/' : current.replace(/\/?[^/]+\/?$/, '') || '/')
  }
  function select(side: Side, name: string, multiple: boolean) {
    const setter = side === 'local' ? setSelectedLocal : setSelectedRemote
    setter((current) =>
      multiple
        ? current.includes(name)
          ? current.filter((value) => value !== name)
          : [...current, name]
        : [name],
    )
  }
  function begin(
    side: Side,
    operation: 'mkdir' | 'rename' | 'remove' | 'chmod',
    explicitEntry?: FileEntry,
  ) {
    const entry =
      explicitEntry ??
      (side === 'local' ? local : remote).find((entry) =>
        (side === 'local' ? selectedLocal : selectedRemote).includes(entry.name),
      )
    setAction({ side, operation, entry })
    setName(
      operation === 'rename'
        ? entry?.name || ''
        : operation === 'chmod'
          ? (entry?.permissions ?? 0o644).toString(8).padStart(4, '0')
          : '',
    )
    if (operation === 'chmod') {
      setOwner(entry?.owner ?? '')
      setGroup(entry?.group ?? '')
    }
    setError('')
  }
  async function mutate() {
    if (!action) return
    if (action.operation === 'chmod' && !/^(?:0?[0-7]{3}|[0-7]{4})$/.test(name)) {
      setError('Введите права в восьмеричном формате, например 0644 или 0755')
      return
    }
    try {
      const targetPath =
        action.operation === 'mkdir' ? path(action.side) : path(action.side, action.entry?.name)
      if (action.operation === 'chmod') {
        const ownerChanged = owner !== (action.entry?.owner ?? ''),
          groupChanged = group !== (action.entry?.group ?? '')
        if ((ownerChanged || groupChanged) && (!owner.trim() || !group.trim())) {
          setError('Укажите владельца и группу')
          return
        }
        if (ownerChanged || groupChanged)
          await window.terminalApi.files.mutate({
            side: action.side,
            sessionId,
            operation: 'chown',
            path: targetPath,
            owner: owner.trim(),
            group: group.trim(),
          })
        if (
          ownerChanged ||
          groupChanged ||
          Number.parseInt(name, 8) !== (action.entry?.permissions ?? 0o644)
        )
          await window.terminalApi.files.mutate({
            side: action.side,
            sessionId,
            operation: 'chmod',
            path: targetPath,
            permissions: Number.parseInt(name, 8),
          })
      } else {
        await window.terminalApi.files.mutate({
          side: action.side,
          sessionId,
          operation: action.operation,
          path: targetPath,
          name,
          fileType: action.entry?.type === 'directory' ? 'empty-directory' : 'file',
        })
      }
      setAction(undefined)
      setRevision((value) => value + 1)
    } catch (error) {
      setError(String(error))
    }
  }
  async function uploadFiles() {
    if (!sessionId) return
    try {
      const files = await window.terminalApi.files.chooseUpload()
      if (files.length) setRequestedLocal(await window.terminalApi.files.localRoot())
      for (const source of files) {
        const name = source.split(/[\\/]/).at(-1)
        if (!name) continue
        await window.terminalApi.files.enqueue({
          sessionId,
          direction: 'upload',
          source,
          target: remotePath.replace(/[\\/]$/, '') + (/^\\\\/.test(remotePath) ? '\\' : '/') + name,
          overwrite: false,
        })
      }
      setTransferError('')
    } catch (error) {
      setTransferError(String(error))
    }
  }
  async function dropFiles(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    setDraggingOver(false)
    if (!sessionId) {
      setTransferError(unsupportedReason || 'Откройте подключение с поддержкой передачи файлов')
      return
    }
    const files = Array.from(event.dataTransfer.files),
      paths = files.map((file) => window.terminalApi.files.getPathForFile(file))
    if (!paths.length || paths.some((source) => !source)) {
      setTransferError('Перетащите файлы из Проводника Windows')
      return
    }
    try {
      await window.terminalApi.files.enqueueDropped(paths, sessionId, remotePath)
      setTransferError('')
    } catch (error) {
      setTransferError(String(error))
    }
  }
  const selectedRemoteEntry = remote.find((entry) => selectedRemote.includes(entry.name))
  const filteredRemote = remote.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  )
  function copyPath(side: Side, entry: FileEntry) {
    return navigator.clipboard.writeText(path(side, entry.name))
  }
  function openEntry(
    side: Side,
    entry: FileEntry,
    mode: 'default' | 'choose' | 'text' = 'default',
  ) {
    if (entry.type !== 'file') {
      navigate(side, path(side, entry.name))
      return
    }
    if (side === 'remote') return openFile(entry, mode)
    return window.terminalApi.files
      .openBrowserLocal(path(side, entry.name), mode)
      .catch((error) => setTransferError(String(error)))
  }
  async function pastePath(side: Side, entry: FileEntry) {
    if (!sessionId || !terminalAvailable) return
    const fullPath = path(side, entry.name)
    if (/[\x00-\x1f\x7f]/.test(fullPath)) throw new Error('Путь содержит управляющие символы')
    if (accessMode === 'local' && !localShell)
      throw new Error('Для вставки пути необходимо определить оболочку терминала')
    if (accessMode === 'local' && localShell === 'cmd' && /["%!]/.test(fullPath))
      throw new Error('Этот путь нельзя безопасно вставить в cmd. Используйте копирование пути.')
    const quoted =
      accessMode === 'local'
        ? localShell === 'cmd'
          ? '"' + fullPath + '"'
          : "'" + fullPath.replaceAll("'", "''") + "'"
        : "'" + fullPath.replaceAll("'", "'\\''") + "'"
    await window.terminalApi.sessions.write(sessionId, quoted)
  }
  return (
    <div className="sftp-browser compact-files">
      <div className={'sftp-columns ' + (mode === 'remote-only' ? 'remote-only' : '')}>
        {(['local', 'remote'] as const).map((side) =>
          mode === 'remote-only' && side === 'local' ? null : (
            <section
              className={`file-side ${draggingOver && side === 'remote' ? 'drag-over' : ''}`}
              key={side}
              onDragOver={
                side === 'remote'
                  ? (event) => {
                      if (Array.from(event.dataTransfer.types).includes('Files')) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'copy'
                        setDraggingOver(true)
                      }
                    }
                  : undefined
              }
              onDragLeave={side === 'remote' ? () => setDraggingOver(false) : undefined}
              onDrop={side === 'remote' ? (event) => void dropFiles(event) : undefined}
            >
              <div className="file-side-heading">
                <strong>
                  {side === 'local'
                    ? 'Этот компьютер'
                    : accessMode === 'wsl'
                      ? 'Файлы WSL'
                      : accessMode === 'local'
                        ? 'Локальные файлы'
                        : 'Удалённый сервер'}
                </strong>
                <button
                  className="transfer-button"
                  disabled={
                    !onTransfer ||
                    !sessionId ||
                    (side === 'local'
                      ? remoteCapabilities?.upload === false
                      : remoteCapabilities?.download === false) ||
                    !(side === 'local' ? selectedLocal : selectedRemote).length
                  }
                  onClick={() =>
                    onTransfer?.(
                      side === 'local' ? 'upload' : 'download',
                      path(side),
                      path(side === 'local' ? 'remote' : 'local'),
                      (side === 'local' ? local : remote).filter((entry) =>
                        (side === 'local' ? selectedLocal : selectedRemote).includes(entry.name),
                      ),
                    )
                  }
                >
                  {side === 'local' ? <ArrowUpFromLine size={12} /> : <ArrowDownToLine size={12} />}{' '}
                  {side === 'local' ? 'Загрузить' : 'Скачать'}
                </button>
                {side === 'remote' && mode === 'remote-only' && (
                  <button
                    className="transfer-button"
                    disabled={!sessionId || remoteCapabilities?.upload === false}
                    onClick={() => void uploadFiles()}
                  >
                    <Upload size={12} /> Загрузить файлы…
                  </button>
                )}
              </div>
              <PathBar
                key={side + path(side) + (side === 'local' ? localError : remoteError)}
                path={path(side)}
                onPath={(next) => navigate(side, next)}
                onRefresh={() => setRevision((value) => value + 1)}
                onChoose={
                  side === 'local'
                    ? () => {
                        window.terminalApi.files
                          .chooseLocal()
                          .then(setRequestedLocal)
                          .catch((error) => setLocalError(String(error)))
                      }
                    : undefined
                }
                onAction={(operation) => begin(side, operation)}
                onPermissions={
                  side === 'remote' && selectedRemoteEntry && !selectedRemoteEntry.isSymlink
                    ? () => begin('remote', 'chmod')
                    : undefined
                }
                selected={(side === 'local' ? selectedLocal : selectedRemote).length}
                capabilities={side === 'remote' ? remoteCapabilities : undefined}
              />
              {side === 'remote' && sessionId && (
                <input
                  className="file-filter"
                  type="search"
                  aria-label="Фильтр файлов"
                  placeholder="Найти в папке…"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              )}
              {(side === 'local' ? localError : remoteError) && (
                <div className="file-inline-error" role="alert">
                  <span>{side === 'local' ? localError : remoteError}</span>
                  <button
                    onClick={() => {
                      navigate(side, failedPaths[side] || path(side))
                      setRevision((value) => value + 1)
                    }}
                  >
                    Повторить
                  </button>
                  <button
                    onClick={() => (side === 'local' ? setLocalError('') : setRemoteError(''))}
                  >
                    ОК
                  </button>
                </div>
              )}
              {side === 'remote' && !sessionId ? (
                <p className="panel-empty">
                  {unsupportedReason || 'Откройте подключение с поддержкой передачи файлов'}
                </p>
              ) : (
                <FileList
                  entries={side === 'local' ? local : filteredRemote}
                  showPermissions={side === 'remote' && accessMode !== 'local'}
                  selected={side === 'local' ? selectedLocal : selectedRemote}
                  activities={
                    side === 'remote'
                      ? new Map(
                          remote.map((entry) => [
                            entry.name,
                            activities[activityKey(path('remote', entry.name))],
                          ]),
                        )
                      : undefined
                  }
                  onSelect={(name, multiple) => select(side, name, multiple)}
                  onContextMenu={(entry, x, y) => setContext({ side, entry, x, y })}
                  onOpen={(entry) => {
                    void openEntry(side, entry)
                  }}
                  onParent={() => parent(side)}
                  dragOwner={dragOwner.current + ':' + side + ':' + (sessionId || '')}
                  onMove={
                    side === 'local' || remoteCapabilities?.rename
                      ? (source, directory) => {
                          if (!directory || source === directory.name) return
                          void window.terminalApi.files
                            .move({
                              side,
                              sessionId: side === 'remote' ? sessionId : undefined,
                              path: path(side, source),
                              destination: path(side, directory.name),
                            })
                            .then(() => {
                              setRevision((value) => value + 1)
                              setTransferError('')
                            })
                            .catch((error) => setTransferError(String(error)))
                        }
                      : undefined
                  }
                  onBeginExternalDrag={
                    side === 'remote' && sessionId && remoteCapabilities?.dragOut
                      ? (entry) => {
                          const request = {
                            sessionId,
                            path: path('remote', entry.name),
                            size: entry.size,
                            modifiedAt: entry.modifiedAt,
                          }
                          // Let Chromium release its drag capture before native OLE takes over.
                          setTimeout(() => {
                            if (activeSession.current !== request.sessionId) return
                            void window.terminalApi.files
                              .beginExternalDrag(request)
                              .catch((error) => setTransferError(String(error)))
                          }, 0)
                          return true
                        }
                      : undefined
                  }
                />
              )}
            </section>
          ),
        )}
      </div>
      {transferError && <p className="error-message">{transferError}</p>}
      {context && (
        <FileContextMenu
          x={context.x}
          y={context.y}
          onClose={() => setContext(undefined)}
          items={[
            ...(!context.entry.isSymlink
              ? [{ label: 'Открыть', run: () => openEntry(context.side, context.entry) }]
              : []),
            ...(context.entry.type === 'file' && !context.entry.isSymlink
              ? [
                  {
                    label: 'Открыть с помощью…',
                    run: () => openEntry(context.side, context.entry, 'choose'),
                  },
                  {
                    label: 'Открыть в текстовом редакторе',
                    run: () => openEntry(context.side, context.entry, 'text'),
                  },
                ]
              : []),
            ...(context.side === 'remote' &&
            (context.entry.type === 'file' || context.entry.type === 'directory') &&
            !context.entry.isSymlink &&
            onTransfer &&
            remoteCapabilities?.download !== false
              ? [
                  {
                    label: 'Скачать',
                    run: () =>
                      onTransfer('download', path('remote'), path('local'), [context.entry]),
                  },
                ]
              : []),
            ...(context.side === 'local' || remoteCapabilities?.rename
              ? [
                  {
                    label: 'Переименовать',
                    run: () => begin(context.side, 'rename', context.entry),
                  },
                ]
              : []),
            ...(context.side === 'local' || remoteCapabilities?.remove
              ? [{ label: 'Удалить', run: () => begin(context.side, 'remove', context.entry) }]
              : []),
            { label: 'Копировать полный путь', run: () => copyPath(context.side, context.entry) },
            ...(terminalAvailable && sessionId && (accessMode !== 'local' || localShell)
              ? [
                  {
                    label: 'Вставить путь в терминал',
                    run: () => pastePath(context.side, context.entry),
                  },
                ]
              : []),
            ...(context.side === 'remote' && !context.entry.isSymlink && remoteCapabilities?.chmod
              ? [{ label: 'Права доступа…', run: () => begin('remote', 'chmod', context.entry) }]
              : []),
            {
              label: 'Свойства',
              run: () => setProperties({ side: context.side, entry: context.entry }),
            },
          ]}
          onError={(error) => setTransferError(String(error))}
        />
      )}
      {properties && (
        <div className="modal-backdrop" onClick={() => setProperties(undefined)}>
          <section
            className="modal file-properties"
            role="dialog"
            aria-modal="true"
            aria-label="Свойства файла"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setProperties(undefined)
            }}
          >
            <h2>Свойства</h2>
            <dl>
              {[
                ['Имя', properties.entry.name],
                ['Путь', path(properties.side, properties.entry.name)],
                [
                  'Тип',
                  properties.entry.isSymlink
                    ? 'Символическая ссылка'
                    : properties.entry.type === 'directory'
                      ? 'Папка'
                      : 'Файл',
                ],
                ['Размер', `${properties.entry.size.toLocaleString('ru-RU')} байт`],
                ['Изменён', new Date(properties.entry.modifiedAt).toLocaleString('ru-RU')],
                ['Владелец', properties.entry.owner || '—'],
                ['Группа', properties.entry.group || '—'],
                [
                  'Доступ',
                  properties.entry.permissions === undefined
                    ? '—'
                    : formatPermissions(properties.entry.permissions),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="modal-actions">
              <button autoFocus className="primary-button" onClick={() => setProperties(undefined)}>
                ОК
              </button>
            </div>
          </section>
        </div>
      )}
      {action && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-label="Операция с файлами"
            onSubmit={(event) => {
              event.preventDefault()
              void mutate()
            }}
          >
            <h2>
              {action.operation === 'mkdir'
                ? 'Новая папка'
                : action.operation === 'rename'
                  ? 'Переименовать'
                  : action.operation === 'chmod'
                    ? `Права доступа: ${action.entry?.name}`
                    : 'Удалить «' + action.entry?.name + '»?'}
            </h2>
            {action.operation === 'remove' ? (
              <p className="muted small">
                Операция необратима. Удаляются только файлы и пустые папки.
              </p>
            ) : action.operation === 'chmod' ? (
              <div className="permission-editor">
                <label>
                  Владелец
                  <input
                    aria-label="Владелец"
                    disabled={!remoteCapabilities?.chown}
                    value={owner}
                    onChange={(event) => setOwner(event.target.value)}
                  />
                </label>
                <label>
                  Группа
                  <input
                    aria-label="Группа"
                    disabled={!remoteCapabilities?.chown}
                    value={group}
                    onChange={(event) => setGroup(event.target.value)}
                  />
                </label>
                <output className="permission-symbolic" aria-label="Символьные права">
                  {formatPermissions(Number.parseInt(name || '0', 8) || 0).split(' · ')[1]}
                </output>
                <div className="permission-classes" aria-label="Права доступа rwx">
                  {(['Владелец', 'Группа', 'Остальные'] as const).map((subject, subjectIndex) => (
                    <div
                      key={subject}
                      className="permission-class"
                      role="group"
                      aria-label={subject}
                    >
                      <span>{subject}</span>
                      {(['Чтение', 'Запись', 'Выполнение'] as const).map(
                        (permission, permissionIndex) => {
                          const bit = 1 << (8 - subjectIndex * 3 - permissionIndex)
                          return (
                            <label key={permission}>
                              <input
                                type="checkbox"
                                aria-label={`${subject}: ${permission}`}
                                checked={Boolean(Number.parseInt(name || '0644', 8) & bit)}
                                onChange={(event) => {
                                  const current = Number.parseInt(name || '0644', 8),
                                    next = event.target.checked ? current | bit : current & ~bit
                                  setName(next.toString(8).padStart(4, '0'))
                                }}
                              />
                              {permission}
                            </label>
                          )
                        },
                      )}
                    </div>
                  ))}
                </div>
                <label>
                  Права доступа (octal)
                  <input
                    required
                    inputMode="numeric"
                    pattern="(0?[0-7]{3}|[0-7]{4})"
                    aria-label="Права доступа (octal)"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                    }}
                  />
                </label>
                <span className="muted small">Например, 0644 или rw-r--r--</span>
              </div>
            ) : (
              <label>
                Имя
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAction(undefined)}
              >
                Отмена
              </button>
              <button className="primary-button">
                {action.operation === 'remove' ? 'Удалить' : 'Сохранить'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function FileContextMenu({
  x,
  y,
  items,
  onClose,
  onError,
}: {
  x: number
  y: number
  items: { label: string; run: () => unknown }[]
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = menu.current!
    const previous = document.activeElement as HTMLElement | null
    const rect = element.getBoundingClientRect()
    element.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 6))}px`
    element.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`
    element.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        previous?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [x, y, onClose])
  return createPortal(
    <div
      ref={menu}
      className="file-context-menu"
      role="menu"
      aria-label="Действия с файлом"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = [...menu.current!.querySelectorAll('button')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[
            (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus()
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose()
            try {
              Promise.resolve(item.run()).catch(onError)
            } catch (error) {
              onError(error)
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
