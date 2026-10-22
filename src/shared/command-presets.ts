import type { TerminalMacro } from './contracts'

export const COMMAND_PRESETS = [
  { name: 'disk', command: 'df -h', description: 'Свободное место на дисках', category: 'Linux' },
  { name: 'memory', command: 'free -h', description: 'Использование памяти', category: 'Linux' },
  {
    name: 'processes',
    command: 'ps aux --sort=-%cpu | head -20',
    description: 'Процессы по загрузке CPU',
    category: 'Linux',
  },
  {
    name: 'journal',
    command: 'journalctl -n 50 --no-pager',
    description: 'Последние записи системного журнала',
    category: 'Linux',
  },
  {
    name: 'network',
    command: 'ip -br address',
    description: 'Адреса сетевых интерфейсов',
    category: 'Linux',
  },
  {
    name: 'listeners',
    command: 'ss -tuln',
    description: 'Прослушиваемые порты',
    category: 'Linux',
  },
  {
    name: 'win-disk',
    command: 'Get-PSDrive -PSProvider FileSystem',
    description: 'Место на дисках · PowerShell',
    category: 'Windows',
  },
  {
    name: 'win-processes',
    command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 20',
    description: 'Процессы по времени CPU · PowerShell',
    category: 'Windows',
  },
] as const

export function macroFromPreset(
  preset: (typeof COMMAND_PRESETS)[number],
  existing: TerminalMacro[],
  id: string,
): TerminalMacro {
  const names = new Set(existing.map((item) => item.name.toLocaleLowerCase()))
  let name: string = preset.name
  let suffix = 2
  while (names.has(name.toLocaleLowerCase())) name = `${preset.name}-${suffix++}`
  return { ...preset, name, id }
}
