import type { LocalShell } from './contracts'

export const localShellLabels: Record<LocalShell, string> = {
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  system: 'Системная оболочка',
  bash: 'Bash',
  zsh: 'Zsh',
}

export function localShellOptions(platform: string): LocalShell[] {
  return platform === 'linux' ? ['system', 'bash', 'zsh'] : ['powershell', 'cmd']
}

export function normalizeLocalShell(shell: LocalShell | undefined, platform: string): LocalShell {
  const options = localShellOptions(platform)
  return shell && options.includes(shell) ? shell : options[0]
}
