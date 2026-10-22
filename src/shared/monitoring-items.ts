export const MONITOR_ITEMS = [
  'host',
  'cpu',
  'temperatures',
  'swap',
  'ram',
  'network-upload',
  'network-download',
  'connections',
  'processes',
  'file-descriptors',
  'uptime',
  'users',
  'disks',
  'nfs',
] as const
export type MonitorItem = (typeof MONITOR_ITEMS)[number]
export const DEFAULT_MONITOR_ITEMS: MonitorItem[] = [
  'host',
  'cpu',
  'temperatures',
  'swap',
  'ram',
  'network-upload',
  'network-download',
  'uptime',
  'users',
  'disks',
]
export const MONITOR_ITEM_LABELS: Record<MonitorItem, string> = {
  host: 'Сервер',
  cpu: 'Процессор',
  temperatures: 'Температуры',
  swap: 'Swap',
  ram: 'Оперативная память',
  'network-upload': 'Исходящий трафик',
  'network-download': 'Входящий трафик',
  connections: 'Сетевые подключения',
  processes: 'Процессы',
  'file-descriptors': 'Файловые дескрипторы',
  uptime: 'Время работы',
  users: 'Пользователи',
  disks: 'Диски',
  nfs: 'Сетевые диски NFS',
}

export function moveMonitorItem(items: MonitorItem[], item: MonitorItem, target: MonitorItem) {
  const from = items.indexOf(item),
    to = items.indexOf(target)
  if (from < 0 || to < 0 || from === to) return items
  const next = [...items]
  next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
