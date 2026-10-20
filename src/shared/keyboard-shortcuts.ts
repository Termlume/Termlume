export const DEFAULT_SHORTCUTS = {
  commands: 'Ctrl+Shift+P',
  'close-active': 'Ctrl+W',
  'next-tab': 'Ctrl+Tab',
  'previous-tab': 'Ctrl+Shift+Tab',
  'new-connection': 'Ctrl+Shift+N',
  'new-local': 'Ctrl+Alt+T',
  'layout-one': 'Ctrl+Alt+1',
  'layout-two-vertical': 'Ctrl+Alt+2',
  'layout-two-horizontal': 'Ctrl+Alt+3',
  'layout-four': 'Ctrl+Alt+4',
} as const
export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS
export type ShortcutBindings = Partial<Record<ShortcutId, string>>
export const SHORTCUT_IDS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]

export function shortcutChord(input: {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}): string | undefined {
  if (input.metaKey || (!input.ctrlKey && !input.altKey)) return undefined
  const key = input.key.length === 1 ? input.key.toUpperCase() : input.key
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Tab|Enter|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Insert|Delete)$/.test(
      key,
    )
  )
    return undefined
  return [input.ctrlKey && 'Ctrl', input.altKey && 'Alt', input.shiftKey && 'Shift', key]
    .filter(Boolean)
    .join('+')
}
export function shortcutBindingsError(bindings: ShortcutBindings): string | undefined {
  const seen = new Set<string>()
  for (const id of SHORTCUT_IDS) {
    const chord = bindings[id] ?? DEFAULT_SHORTCUTS[id]
    const parts = chord.split('+'),
      key = parts.pop() || ''
    const canonical = shortcutChord({
      key,
      ctrlKey: parts.includes('Ctrl'),
      altKey: parts.includes('Alt'),
      shiftKey: parts.includes('Shift'),
    })
    if (canonical !== chord)
      return 'Используйте Ctrl или Alt и букву, цифру, F1–F12 либо навигационную клавишу.'
    if (
      [
        'Ctrl+C',
        'Ctrl+D',
        'Ctrl+Z',
        'Ctrl+Shift+C',
        'Ctrl+Shift+V',
        'Alt+F4',
        'Ctrl+Alt+Delete',
      ].includes(chord)
    )
      return 'Это сочетание зарезервировано терминалом или Windows.'
    if (seen.has(chord)) return `Сочетание ${chord} уже используется другим действием.`
    seen.add(chord)
  }
}
export function findShortcut(
  input: Parameters<typeof shortcutChord>[0],
  bindings: ShortcutBindings = {},
): ShortcutId | undefined {
  const chord = shortcutChord(input)
  return chord
    ? SHORTCUT_IDS.find((id) => (bindings[id] ?? DEFAULT_SHORTCUTS[id]) === chord)
    : undefined
}
