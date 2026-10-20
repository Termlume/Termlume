import type { ITheme } from '@xterm/xterm'
import type { ThemeId } from '../../../shared/contracts'
import { getTheme } from './palettes'
export function applyTheme(id: ThemeId): void {
  const theme = getTheme(id),
    root = document.documentElement
  root.dataset.theme = theme.id
  window.terminalApi?.app?.setTheme?.(theme.id)
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  for (const [name, value] of Object.entries(theme.colors))
    root.style.setProperty('--' + name, value)
  window.dispatchEvent(new CustomEvent<ThemeId>('terminal-theme-change', { detail: id }))
}
export function terminalTheme(id: ThemeId): ITheme {
  const theme = getTheme(id),
    a = theme.ansi
  return {
    background: theme.colors.bg,
    foreground: theme.colors.text,
    cursor: theme.colors.accent,
    cursorAccent: theme.colors.bg,
    selectionBackground: theme.colors.accent + '44',
    black: a[0],
    red: a[1],
    green: a[2],
    yellow: a[3],
    blue: a[4],
    magenta: a[5],
    cyan: a[6],
    white: a[7],
    brightBlack: a[8],
    brightRed: a[9],
    brightGreen: a[10],
    brightYellow: a[11],
    brightBlue: a[12],
    brightMagenta: a[13],
    brightCyan: a[14],
    brightWhite: a[15],
  }
}
export class ThemeController {
  private current: ThemeId
  constructor(
    private saved: ThemeId,
    private persist: (id: ThemeId) => Promise<void>,
  ) {
    this.current = saved
  }
  preview(id: ThemeId) {
    this.current = id
    applyTheme(id)
  }
  cancel() {
    this.current = this.saved
    applyTheme(this.saved)
  }
  async apply() {
    await this.persist(this.current)
    this.saved = this.current
  }
}
