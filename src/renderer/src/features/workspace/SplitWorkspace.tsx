import { useEffect, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import {
  addSession,
  buildPresetLayout,
  clampRatio,
  createLayout,
  findSessions,
  removeSession,
  swapSessions,
  type SplitAxis,
  type LayoutPreset,
  type WorkspaceLayout,
} from './workspace-layout'
import {
  Box,
  Columns2,
  Grid2x2,
  KeyRound,
  Network,
  Plus,
  Rows2,
  Search,
  Square,
  SquareTerminal,
} from 'lucide-react'
import type { SessionProfile } from '../../../../shared/contracts'

export type SplitSessionOption = {
  id: string
  name: string
  protocol: SessionProfile['protocol']
}

type Bounds = { x: number; y: number; width: number; height: number }
type Bar = { path: number[]; axis: SplitAxis; ratio: number; bounds: Bounds }

export function SplitWorkspace({
  sessionIds,
  activeId,
  sessionNames = {},
  sessionOptions = [],
  layoutPreset,
  onFocus,
  renderSession,
}: {
  sessionIds: string[]
  activeId?: string
  sessionNames?: Record<string, string>
  sessionOptions?: SplitSessionOption[]
  layoutPreset?: { revision: number; preset: LayoutPreset }
  onFocus: (sessionId: string) => void
  renderSession: (sessionId: string, visible: boolean) => ReactNode
}) {
  const [layout, setLayout] = useState<WorkspaceLayout | undefined>(
    activeId ? createLayout(activeId) : undefined,
  )
  const [pickerOpen, setPickerOpen] = useState(false),
    [search, setSearch] = useState(''),
    [selectedPreset, setSelectedPreset] = useState<LayoutPreset | undefined>('one')
  useEffect(() => {
    setLayout((current) => {
      let next = current
      for (const id of findSessions(next))
        if (!sessionIds.includes(id)) next = removeSession(next, id)
      if (!next && activeId) return createLayout(activeId)
      if (next?.type === 'leaf' && activeId && next.sessionId !== activeId)
        return createLayout(activeId)
      if (next && activeId && !findSessions(next).includes(activeId)) {
        const expanded = addSession(next, activeId, 'vertical')
        return expanded === next ? createLayout(activeId) : expanded
      }
      return next
    })
  }, [activeId, sessionIds])
  useEffect(() => {
    if (!layoutPreset) return
    setLayout(buildPresetLayout(sessionIds, activeId, layoutPreset.preset))
    setSelectedPreset(layoutPreset.preset)
  }, [layoutPreset?.revision])
  const visible = findSessions(layout),
    visibleSet = new Set(visible),
    bars: Bar[] = []
  function collect(node: WorkspaceLayout | undefined, bounds: Bounds, path: number[] = []) {
    if (!node || node.type === 'leaf') return
    bars.push({ path, axis: node.axis, ratio: node.ratio, bounds })
    if (node.axis === 'vertical') {
      collect(node.first, { ...bounds, width: bounds.width * node.ratio }, [...path, 0])
      collect(
        node.second,
        {
          x: bounds.x + bounds.width * node.ratio,
          y: bounds.y,
          width: bounds.width * (1 - node.ratio),
          height: bounds.height,
        },
        [...path, 1],
      )
    } else {
      collect(node.first, { ...bounds, height: bounds.height * node.ratio }, [...path, 0])
      collect(
        node.second,
        {
          x: bounds.x,
          y: bounds.y + bounds.height * node.ratio,
          width: bounds.width,
          height: bounds.height * (1 - node.ratio),
        },
        [...path, 1],
      )
    }
  }
  collect(layout, { x: 0, y: 0, width: 1, height: 1 })
  const changeRatio = (path: number[], ratio: number) =>
    setLayout((current) => updateRatio(current, path, 0, ratio))
  const resize = (bar: Bar, event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return
    const canvas = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!canvas) return
    const coordinate =
        bar.axis === 'vertical' ? event.clientX - canvas.left : event.clientY - canvas.top,
      origin = bar.axis === 'vertical' ? bar.bounds.x * canvas.width : bar.bounds.y * canvas.height,
      extent =
        bar.axis === 'vertical'
          ? bar.bounds.width * canvas.width
          : bar.bounds.height * canvas.height
    if (extent > 0) changeRatio(bar.path, (coordinate - origin) / extent)
  }
  const add = (sessionId: string) => {
    setLayout((current) => addSession(current, sessionId, 'vertical'))
    setPickerOpen(false)
    setSearch('')
    setSelectedPreset(undefined)
  }
  const name = (id: string) => sessionNames[id] || id
  const options = sessionOptions.length
    ? sessionOptions
    : sessionIds.map((id) => ({ id, name: name(id), protocol: 'ssh' as const }))
  const protocolInfo = {
    sftp: { label: 'SFTP', Icon: KeyRound },
    ftp: { label: 'FTP', Icon: Network },
    ssh: { Icon: KeyRound, label: 'SSH' },
    telnet: { Icon: Network, label: 'Telnet' },
    wsl: { Icon: Box, label: 'WSL' },
    local: { Icon: SquareTerminal, label: 'Локальная' },
  }
  const presets: { preset: LayoutPreset; label: string; shortcut: string; Icon: typeof Square }[] =
    [
      { preset: 'one', label: 'Одна панель', shortcut: 'Ctrl+Alt+1', Icon: Square },
      { preset: 'two-vertical', label: 'Две панели рядом', shortcut: 'Ctrl+Alt+2', Icon: Columns2 },
      {
        preset: 'two-horizontal',
        label: 'Две панели сверху и снизу',
        shortcut: 'Ctrl+Alt+3',
        Icon: Rows2,
      },
      { preset: 'four', label: 'Четыре панели', shortcut: 'Ctrl+Alt+4', Icon: Grid2x2 },
    ]
  const applyPreset = (preset: LayoutPreset) => {
    setLayout(buildPresetLayout(sessionIds, activeId, preset))
    setSelectedPreset(preset)
  }
  const availableOptions = options.filter(({ id }) => !visibleSet.has(id))
  const choices = availableOptions.filter(({ id, name: connectionName, protocol }) =>
    `${connectionName} ${protocolInfo[protocol].label}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  )
  return (
    <div className="split-workspace" aria-label="Рабочая область терминала">
      <div className="split-toolbar">
        <div className="split-layout-controls" role="group" aria-label="Раскладка терминалов">
          {presets.map(({ preset, label, shortcut, Icon }) => (
            <button
              key={preset}
              className={'split-layout-button ' + (selectedPreset === preset ? 'selected' : '')}
              aria-label={label}
              aria-pressed={selectedPreset === preset}
              title={`${label} · ${shortcut}`}
              onClick={() => applyPreset(preset)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div className="split-add-wrap">
          <button
            className="split-add-button"
            aria-label="Добавить терминал"
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
            disabled={visible.length >= 4 || availableOptions.length === 0}
            onClick={() => {
              setSearch('')
              setPickerOpen((current) => !current)
            }}
          >
            <Plus size={14} /> Добавить терминал
          </button>
          {pickerOpen && (
            <div
              className="split-tab-picker"
              role="menu"
              aria-label="Открытые вкладки"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPickerOpen(false)
              }}
            >
              <label className="split-tab-search">
                <Search size={13} />
                <input
                  autoFocus
                  type="search"
                  aria-label="Поиск вкладок"
                  placeholder="Поиск вкладок"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {choices.map(({ id, name: connectionName, protocol }) => {
                const { Icon, label } = protocolInfo[protocol]
                return (
                  <button
                    key={id}
                    role="menuitem"
                    aria-label={`${connectionName} · ${label}`}
                    onClick={() => add(id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{connectionName}</span>
                    <small>{label}</small>
                  </button>
                )
              })}
              {choices.length === 0 && (
                <div className="split-tab-empty">Нет подходящих вкладок</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="split-canvas">
        {sessionIds.map((id) => {
          const index = visible.indexOf(id),
            rect = index < 0 ? undefined : leafBounds(layout, id)
          const style: CSSProperties = rect
            ? {
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }
            : { display: 'none' }
          return (
            <div
              key={id}
              className="split-session"
              style={style}
              onMouseDown={() => onFocus(id)}
              data-split-session={id}
            >
              {visibleSet.has(id) && (
                <div
                  className="split-session-heading"
                  draggable={visible.length > 1}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event) => {
                    if (visible.length > 1) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const source = event.dataTransfer.getData('text/plain')
                    if (!source || source === id) return
                    setLayout((current) => swapSessions(current, source, id))
                    setSelectedPreset(undefined)
                  }}
                  title="Перетащите заголовок на другую панель, чтобы поменять их местами"
                >
                  <span>{name(id)}</span>
                  {visible.length > 1 && (
                    <button
                      aria-label={'Развернуть панель ' + name(id)}
                      onClick={() => {
                        setLayout(createLayout(id))
                        setSelectedPreset('one')
                      }}
                    >
                      Развернуть
                    </button>
                  )}
                  {visible.length > 1 && (
                    <button
                      aria-label={'Убрать панель ' + name(id)}
                      onClick={() => {
                        const next = removeSession(layout, id)
                        setLayout(next)
                        setSelectedPreset(undefined)
                        const remaining = findSessions(next)
                        if (!remaining.includes(activeId || '')) onFocus(remaining[0] || '')
                      }}
                    >
                      Убрать
                    </button>
                  )}
                </div>
              )}
              <div className="split-session-terminal">{renderSession(id, visibleSet.has(id))}</div>
            </div>
          )
        })}
        {bars.map((bar) => {
          const horizontal = bar.axis === 'vertical',
            pos = horizontal
              ? {
                  left: `${(bar.bounds.x + bar.bounds.width * bar.ratio) * 100}%`,
                  top: `${bar.bounds.y * 100}%`,
                  height: `${bar.bounds.height * 100}%`,
                }
              : {
                  top: `${(bar.bounds.y + bar.bounds.height * bar.ratio) * 100}%`,
                  left: `${bar.bounds.x * 100}%`,
                  width: `${bar.bounds.width * 100}%`,
                }
          return (
            <div
              key={bar.path.join('-')}
              className={
                'split-separator ' +
                (horizontal ? 'split-separator-vertical' : 'split-separator-horizontal')
              }
              style={pos}
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              aria-label="Изменить размер панели"
              aria-valuenow={Math.round(bar.ratio * 100)}
              tabIndex={0}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => resize(bar, event)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
                changeRatio(bar.path, clampRatio(bar.ratio + direction * 0.03))
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function leafBounds(layout: WorkspaceLayout | undefined, sessionId: string): Bounds | undefined {
  if (!layout) return undefined
  const visit = (node: WorkspaceLayout, bounds: Bounds): Bounds | undefined => {
    if (node.type === 'leaf') return node.sessionId === sessionId ? bounds : undefined
    if (node.axis === 'vertical')
      return (
        visit(node.first, { ...bounds, width: bounds.width * node.ratio }) ||
        visit(node.second, {
          x: bounds.x + bounds.width * node.ratio,
          y: bounds.y,
          width: bounds.width * (1 - node.ratio),
          height: bounds.height,
        })
      )
    return (
      visit(node.first, { ...bounds, height: bounds.height * node.ratio }) ||
      visit(node.second, {
        x: bounds.x,
        y: bounds.y + bounds.height * node.ratio,
        width: bounds.width,
        height: bounds.height * (1 - node.ratio),
      })
    )
  }
  return visit(layout, { x: 0, y: 0, width: 1, height: 1 })
}

function updateRatio(
  node: WorkspaceLayout | undefined,
  path: number[],
  depth: number,
  ratio: number,
): WorkspaceLayout | undefined {
  if (!node || node.type === 'leaf') return node
  if (depth === path.length) return { ...node, ratio: clampRatio(ratio) }
  if (path[depth] === 0) return { ...node, first: updateRatio(node.first, path, depth + 1, ratio)! }
  return { ...node, second: updateRatio(node.second, path, depth + 1, ratio)! }
}
