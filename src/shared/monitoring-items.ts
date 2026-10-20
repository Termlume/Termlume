export const MONITOR_ITEMS = [
  'host',
  'cpu',
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
