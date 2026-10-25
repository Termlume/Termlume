import type { FileAccessMode } from '../../../../shared/contracts'
/** Convert a trusted terminal cwd hint to the browser's filesystem notation. */
export function terminalDirectoryPath(
  value: string,
  home: string,
  mode: FileAccessMode,
): string | undefined {
  if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return
  if (value === '~') value = home
  else if (value.startsWith('~/')) value = home.replace(/[\\/]$/, '') + value.slice(1)
  if (mode === 'wsl') {
    const root = /^(\\\\(?:wsl\.localhost|wsl\$)\\[^\\/]+)/i.exec(home)?.[1]
    if (!root) return
    if (value.startsWith('/')) return root + value.replaceAll('/', '\\')
    if (
      value.toLowerCase() === root.toLowerCase() ||
      value.toLowerCase().startsWith(root.toLowerCase() + '\\')
    )
      return value.replaceAll('/', '\\')
    return
  }
  if (mode === 'local' && home.startsWith('/')) return value.startsWith('/') ? value : undefined
  if (mode === 'local')
    return /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value) && !/^\\\\[?.]\\/.test(value)
      ? value
      : undefined
  return value.startsWith('/') ? value : undefined
}
