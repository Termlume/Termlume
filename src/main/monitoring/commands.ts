export const commands = {
  os: 'uname -s',
  fast: "printf '__TERMINAL_CPU__\\n'; cat /proc/stat 2>/dev/null || :; printf '\\n__TERMINAL_MEM__\\n'; cat /proc/meminfo 2>/dev/null || :; printf '\\n__TERMINAL_NET__\\n'; cat /proc/net/dev 2>/dev/null || :; printf '\\n__TERMINAL_UPTIME__\\n'; cat /proc/uptime 2>/dev/null || :",
  disks: 'LC_ALL=C df -Pk',
}
export function sections(text: string): Record<string, string> {
  const result: Record<string, string> = {},
    parts = text.split(/__TERMINAL_(CPU|MEM|NET|UPTIME)__\r?\n/)
  for (let i = 1; i < parts.length; i += 2) result[parts[i]] = parts[i + 1] || ''
  return result
}
