import { sessionSourceText } from './session-source'
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Metric, MetricSnapshot } from '../../../../shared/contracts'
import {
  DEFAULT_MONITOR_ITEMS,
  MONITOR_ITEMS,
  MONITOR_ITEM_LABELS,
  type MonitorItem,
} from '../../../../shared/monitoring-items'
import { bytes } from './format'
import { CapacityBar } from './CapacityBar'
import { HistoryChart } from './HistoryChart'
import { MonitoringHover, MonitoringHoverGroup } from './MonitoringHover'

export function uptimeText(seconds: number) {
  return `${Math.floor(seconds / 86400)}д ${Math.floor((seconds % 86400) / 3600)}ч ${Math.floor((seconds % 3600) / 60)}м`
}
const choices = MONITOR_ITEMS.map((item) => [item, MONITOR_ITEM_LABELS[item]] as const)
const data = <T,>(metric?: Metric<T>) => (metric?.status === 'ok' ? metric.value : undefined)
const reason = (metric?: Metric<unknown>) =>
  metric?.error || (metric?.status === 'unavailable' ? 'Недоступно' : 'Ожидание данных')
export function MonitoringBar({
  snapshot,
  server,
  visibleItems = DEFAULT_MONITOR_ITEMS,
  onVisibleItemsChange,
  onResetItems,
  expanded = false,
}: {
  snapshot?: MetricSnapshot
  server: string
  visibleItems?: MonitorItem[]
  onVisibleItemsChange?: (items: MonitorItem[]) => void
  onResetItems?: () => void
  expanded?: boolean
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>()
  const [actionError, setActionError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(undefined)
        barRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', key)
    }
  }, [menu])
  const cpu = data(snapshot?.cpuPercent),
    ram = data(snapshot?.ram),
    network = data(snapshot?.network),
    users = data(snapshot?.users)?.sessions,
    disks = data(snapshot?.disks),
    uptime = data(snapshot?.uptime),
    system = data(snapshot?.system)
  const has = (item: MonitorItem) => visibleItems.includes(item)
  const summary = `${server}\nCPU: ${cpu === undefined ? '—' : cpu.toFixed(1) + '%'}\nRAM: ${ram ? bytes(ram.used) + ' / ' + bytes(ram.total) : '—'}\n↑ ${network ? bytes(network.tx) + '/с' : '—'}  ↓ ${network ? bytes(network.rx) + '/с' : '—'}\nUptime: ${uptime === undefined ? '—' : uptimeText(uptime)}\nПользователи: ${users?.map((s) => s.user).join(', ') || '—'}\n${disks?.map((d) => `${d.mount}: ${bytes(d.used)} / ${bytes(d.total)} (${d.percent}%)`).join('\n') || ''}`
  return (
    <MonitoringHoverGroup expanded={expanded}>
      <div
        ref={barRef}
        tabIndex={-1}
        className={expanded ? 'monitoring-bar monitoring-expanded' : 'monitoring-bar'}
        role="toolbar"
        aria-label={`Мониторинг ${server}`}
        onContextMenu={(event) => {
          event.preventDefault()
          setActionError('')
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const box = barRef.current!.getBoundingClientRect()
            setMenu({ x: box.left, y: box.top })
          }
        }}
      >
        {visibleItems.map((selectedItem) => {
          const has = (item: MonitorItem) => item === selectedItem
          return (
            <Fragment key={selectedItem}>
              {has('host') && (
                <MonitoringHover label="Сервер" value={server}>
                  <p>{system?.hostname || server}</p>
                  {snapshot?.error && <p>{snapshot.error}</p>}
                  <small>
                    {snapshot
                      ? `Обновлено ${new Date(snapshot.sampledAt).toLocaleTimeString('ru-RU')}`
                      : 'Ожидание данных'}
                  </small>
                </MonitoringHover>
              )}
              {has('cpu') && (
                <MonitoringHover label="CPU" value={cpu === undefined ? '—' : `${cpu.toFixed(1)}%`}>
                  <p>
                    {cpu === undefined ? reason(snapshot?.cpuPercent) : `${cpu.toFixed(1)}% занято`}
                  </p>
                  <HistoryChart
                    values={snapshot?.history.map((p) => p.cpuPercent) || []}
                    label="Загрузка CPU за последние 5 минут"
                  />
                  {system?.loadAverage && <p>Load average: {system.loadAverage.join(' · ')}</p>}
                </MonitoringHover>
              )}
              {has('temperatures') && (
                <MonitoringHover
                  label="Температуры"
                  value={
                    data(snapshot?.temperatures)
                      ?.map((s) => `${s.celsius.toFixed(1)}°C`)
                      .join(' · ') || 'Недоступно'
                  }
                >
                  {data(snapshot?.temperatures)?.map((s) => (
                    <p key={s.id} title={s.id}>
                      {s.label}: {s.celsius.toFixed(1)}°C
                    </p>
                  )) || <p>{reason(snapshot?.temperatures)}</p>}
                </MonitoringHover>
              )}
              {has('swap') && (
                <MonitoringHover
                  label="Swap"
                  value={
                    data(snapshot?.swap)
                      ? `${bytes(data(snapshot?.swap)!.used)} / ${bytes(data(snapshot?.swap)!.total)}`
                      : 'Недоступно'
                  }
                >
                  <CapacityBar label="Swap" usage={data(snapshot?.swap)} />
                  {!data(snapshot?.swap) && <p>{reason(snapshot?.swap)}</p>}
                </MonitoringHover>
              )}
              {has('ram') && (
                <MonitoringHover
                  label="RAM"
                  value={ram ? `${bytes(ram.used)} / ${bytes(ram.total)}` : '—'}
                >
                  {ram ? (
                    <>
                      <CapacityBar label="Оперативная память" usage={ram} />
                      <p>Кэш: {ram.cached === undefined ? '—' : bytes(ram.cached)}</p>
                      <p>Буферы: {ram.buffers === undefined ? '—' : bytes(ram.buffers)}</p>
                    </>
                  ) : (
                    <p>{reason(snapshot?.ram)}</p>
                  )}
                </MonitoringHover>
              )}
              {(['network-upload', 'network-download'] as const).filter(has).map((item) => {
                const upload = item === 'network-upload'
                return (
                  <MonitoringHover
                    key={item}
                    label={upload ? '↑' : '↓'}
                    value={network ? `${bytes(upload ? network.tx : network.rx)}/с` : '—'}
                  >
                    <p>{upload ? 'Исходящий трафик' : 'Входящий трафик'}</p>
                    {network ? (
                      network.interfaces.map((i) => (
                        <p key={i.name}>
                          {i.name}: {bytes(upload ? i.tx : i.rx)}/с
                        </p>
                      ))
                    ) : (
                      <p>{reason(snapshot?.network)}</p>
                    )}
                    <HistoryChart
                      values={snapshot?.history.map((p) => (upload ? p.tx : p.rx)) || []}
                      max={0}
                      label={upload ? 'Исходящий сетевой трафик' : 'Входящий сетевой трафик'}
                    />
                  </MonitoringHover>
                )
              })}
              {has('connections') && (
                <MonitoringHover
                  label="Соединения"
                  value={system?.connections ? String(system.connections.total) : '—'}
                >
                  {system?.connections ? (
                    <>
                      <p>Установлено TCP-соединений: {system.connections.total}</p>
                      <div className="monitoring-connections-output">
                        <pre>
                          {system.connections.details !== undefined
                            ? (system.connections.source === 'ss'
                                ? 'State  Recv-Q Send-Q Local Address          Peer Address           Process\n'
                                : '') + (system.connections.details || 'Нет TCP-соединений')
                            : system.connections.ports
                                .map((p) => `Порт ${p.port}: ${p.count}`)
                                .join('\n') || 'Нет установленных соединений'}
                        </pre>
                      </div>
                      {system.connections.truncated && (
                        <small>Показана первая часть списка (64 КБ).</small>
                      )}
                      <small>
                        LISTEN — слушающий порт, ESTAB/ESTABLISHED — установленное соединение. PID и
                        программа видны при наличии прав.
                      </small>
                    </>
                  ) : (
                    <p>{reason(snapshot?.system)}</p>
                  )}
                </MonitoringHover>
              )}
              {has('processes') && (
                <MonitoringHover
                  label="Процессы"
                  value={
                    system?.processes
                      ? `${system.processes.running} / ${system.processes.total}`
                      : '—'
                  }
                >
                  <p>
                    {system?.processes
                      ? `Работают: ${system.processes.running} · всего: ${system.processes.total}`
                      : reason(snapshot?.system)}
                  </p>
                </MonitoringHover>
              )}
              {has('file-descriptors') && (
                <MonitoringHover
                  label="Дескрипторы"
                  value={
                    system?.fileDescriptors
                      ? `${system.fileDescriptors.allocated} / ${system.fileDescriptors.maximum}`
                      : '—'
                  }
                >
                  <p>
                    {system?.fileDescriptors
                      ? `Выделено: ${system.fileDescriptors.allocated} · максимум: ${system.fileDescriptors.maximum}`
                      : reason(snapshot?.system)}
                  </p>
                </MonitoringHover>
              )}
              {has('uptime') && (
                <MonitoringHover
                  label="Uptime"
                  value={uptime === undefined ? '—' : uptimeText(uptime)}
                >
                  <p>
                    {uptime === undefined
                      ? reason(snapshot?.uptime)
                      : `Сервер работает ${uptimeText(uptime)}`}
                  </p>
                </MonitoringHover>
              )}
              {has('users') && (
                <MonitoringHover
                  label="Пользователи"
                  value={
                    users ? [...new Set(users.map((s) => s.user))].join(', ') || 'Нет сеансов' : '—'
                  }
                >
                  {users ? (
                    <div className="monitor-users-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Пользователь</th>
                            <th>Терминал</th>
                            <th>Вход</th>
                            <th>Адрес</th>
                            <th>Источник</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((s, i) => (
                            <tr key={`${s.user}:${s.terminal}:${i}`}>
                              <td>{s.user}</td>
                              <td>{s.terminal || '—'}</td>
                              <td>{s.loginText || '—'}</td>
                              <td>{s.from || '—'}</td>
                              <td>{sessionSourceText(s.source)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!users.length && <p>Нет зарегистрированных сеансов</p>}
                    </div>
                  ) : (
                    <p>{reason(snapshot?.users)}</p>
                  )}
                </MonitoringHover>
              )}
              {has('disks') &&
                (disks?.length ? (
                  disks.map((d) => (
                    <MonitoringHover
                      key={d.device + ':' + d.mount}
                      label={d.mount}
                      value={`${d.percent}%`}
                    >
                      <p>
                        {d.device} → {d.mount}
                      </p>
                      <CapacityBar label={`Диск ${d.mount}`} usage={d} />
                    </MonitoringHover>
                  ))
                ) : (
                  <MonitoringHover label="Диски" value="—">
                    <p>{reason(snapshot?.disks)}</p>
                  </MonitoringHover>
                ))}
              {has('nfs') && (
                <MonitoringHover
                  label="NFS"
                  value={system?.nfsMounts ? String(system.nfsMounts.length) : '—'}
                >
                  {system?.nfsMounts ? (
                    system.nfsMounts.length ? (
                      system.nfsMounts.map((n) => (
                        <p key={n.source + ':' + n.mount}>
                          {n.source} → {n.mount} ({n.type})
                        </p>
                      ))
                    ) : (
                      <p>Нет NFS-подключений</p>
                    )
                  ) : (
                    <p>{reason(snapshot?.system)}</p>
                  )}
                </MonitoringHover>
              )}
            </Fragment>
          )
        })}
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Настройка мониторинга"
            className="monitoring-context-menu"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)),
              bottom: Math.max(8, window.innerHeight - menu.y),
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const items = Array.from(
                  menuRef.current!.querySelectorAll<HTMLButtonElement>('button'),
                )
                const index = items.indexOf(document.activeElement as HTMLButtonElement)
                items[
                  (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
                ]?.focus()
              }
            }}
          >
            {choices.map(([item, label]) => (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={has(item)}
                disabled={!onVisibleItemsChange}
                key={item}
                onClick={() =>
                  onVisibleItemsChange?.(
                    has(item) ? visibleItems.filter((i) => i !== item) : [...visibleItems, item],
                  )
                }
              >
                <span aria-hidden="true">{has(item) ? '✓' : ''}</span>
                {label}
              </button>
            ))}
            <hr />
            {onResetItems && (
              <button type="button" role="menuitem" onClick={onResetItems}>
                Сбросить к общим настройкам
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary)
                  setMenu(undefined)
                } catch {
                  setActionError('Не удалось скопировать сводку')
                }
              }}
            >
              Копировать сводку
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([summary], { type: 'text/plain;charset=utf-8' }),
                )
                const link = document.createElement('a')
                link.href = url
                link.download = 'monitoring.txt'
                link.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
                setMenu(undefined)
              }}
            >
              Сохранить сводку…
            </button>
            {actionError && <p role="status">{actionError}</p>}
          </div>,
          document.body,
        )}
    </MonitoringHoverGroup>
  )
}
