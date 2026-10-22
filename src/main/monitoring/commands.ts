import { temperatureCommand } from './temperatures'
export const commands = {
  temperatures: temperatureCommand,
  os: 'uname -s',
  fast: "printf '__TERMINAL_CPU__\\n'; cat /proc/stat 2>/dev/null || :; printf '\\n__TERMINAL_MEM__\\n'; cat /proc/meminfo 2>/dev/null || :; printf '\\n__TERMINAL_NET__\\n'; cat /proc/net/dev 2>/dev/null || :; printf '\\n__TERMINAL_UPTIME__\\n'; cat /proc/uptime 2>/dev/null || :",
  system:
    "printf '__TERMINAL_LOAD__\\n'; cat /proc/loadavg 2>/dev/null || :; printf '\\n__TERMINAL_PROCESSES__\\n'; if LC_ALL=C ps -e -o stat= 2>/dev/null; then printf '__PS_OK__\\n'; fi; printf '\\n__TERMINAL_FILES__\\n'; cat /proc/sys/fs/file-nr 2>/dev/null || :; printf '\\n__TERMINAL_MOUNTS__\\n'; if cat /proc/mounts 2>/dev/null; then printf '__MOUNTS_OK__\\n'; fi; printf '\\n__TERMINAL_HOST__\\n'; hostname 2>/dev/null || :; printf '\\n__TERMINAL_CONNECTIONS__\\n'; if command -v ss >/dev/null 2>&1 && LC_ALL=C ss -Htanp 2>/dev/null; then printf '__SS_OK__\\n'; elif command -v netstat >/dev/null 2>&1 && LC_ALL=C netstat -antp 2>/dev/null; then printf '__NETSTAT_OK__\\n'; fi",
  loginSessions: `LC_ALL=C loginctl list-sessions --no-legend --no-pager 2>/dev/null | while read -r id rest; do loginctl show-session "$id" -p Name -p TTY -p RemoteHost -p Class -p State --no-pager 2>/dev/null; printf '__SESSION_END__\\n'; done`,
  processSessions: 'LC_ALL=C ps -eo user=,tty=,args=',
  disks: 'LC_ALL=C df -Pk',
  users: 'LC_ALL=C who',
}
export function sections(text: string): Record<string, string> {
  const result: Record<string, string> = {},
    parts = text.split(
      /__TERMINAL_(CPU|MEM|NET|UPTIME|LOAD|PROCESSES|FILES|MOUNTS|HOST|CONNECTIONS)__\r?\n/,
    )
  for (let i = 1; i < parts.length; i += 2) result[parts[i]] = parts[i + 1] || ''
  return result
}
