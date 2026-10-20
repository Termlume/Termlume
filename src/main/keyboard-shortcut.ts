import { findShortcut, type ShortcutBindings } from '../shared/keyboard-shortcuts'
export function shouldRelayShortcut(
  input: {
    type: string
    key: string
    control: boolean
    shift: boolean
    alt: boolean
    meta?: boolean
  },
  bindings: ShortcutBindings = {},
): boolean {
  return (
    input.type === 'keyDown' &&
    !!findShortcut(
      {
        key: input.key,
        ctrlKey: input.control,
        shiftKey: input.shift,
        altKey: input.alt,
        metaKey: input.meta,
      },
      bindings,
    )
  )
}
