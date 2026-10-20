import {
  DEFAULT_SHORTCUTS,
  findShortcut,
  type ShortcutBindings,
  type ShortcutId,
} from '../../../shared/keyboard-shortcuts'
import type { LayoutPreset } from '../features/workspace/workspace-layout'

export type ShortcutAction =
  | 'close-active'
  | 'next-tab'
  | 'previous-tab'
  | 'new-connection'
  | 'new-local'
  | 'commands'
  | { type: 'set-layout'; preset: LayoutPreset }

export type ShortcutContext = {
  hasActiveTab: boolean
  tabCount: number
  modalOpen: boolean
  formFieldTarget: boolean
}

export const SHORTCUT_BINDINGS: readonly {
  action: ShortcutAction
  keys: string
  description: string
}[] = [
  { action: 'commands', keys: 'Ctrl+Shift+P', description: 'Поиск команд и подключений' },
  { action: 'close-active', keys: 'Ctrl+W', description: 'Закрыть активную вкладку' },
  { action: 'next-tab', keys: 'Ctrl+Tab', description: 'Следующая вкладка' },
  { action: 'previous-tab', keys: 'Ctrl+Shift+Tab', description: 'Предыдущая вкладка' },
  { action: 'new-connection', keys: 'Ctrl+Shift+N', description: 'Новое SSH-подключение' },
  { action: 'new-local', keys: 'Ctrl+Alt+T', description: 'Новая локальная консоль' },
  {
    action: { type: 'set-layout', preset: 'one' },
    keys: 'Ctrl+Alt+1',
    description: 'Один терминал',
  },
  {
    action: { type: 'set-layout', preset: 'two-vertical' },
    keys: 'Ctrl+Alt+2',
    description: 'Два терминала рядом',
  },
  {
    action: { type: 'set-layout', preset: 'two-horizontal' },
    keys: 'Ctrl+Alt+3',
    description: 'Два терминала сверху и снизу',
  },
  {
    action: { type: 'set-layout', preset: 'four' },
    keys: 'Ctrl+Alt+4',
    description: 'Четыре терминала',
  },
]

const actionIds: Record<string, ShortcutId> = {
  commands: 'commands',
  'close-active': 'close-active',
  'next-tab': 'next-tab',
  'previous-tab': 'previous-tab',
  'new-connection': 'new-connection',
  'new-local': 'new-local',
}
export function shortcutId(action: ShortcutAction): ShortcutId {
  return typeof action === 'string' ? actionIds[action] : (`layout-${action.preset}` as ShortcutId)
}
export function shortcutKeys(action: ShortcutAction, bindings: ShortcutBindings = {}): string {
  const id = shortcutId(action)
  return bindings[id] ?? DEFAULT_SHORTCUTS[id]
}
export function routeShortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
  bindings: ShortcutBindings = {},
): ShortcutAction | undefined {
  if (context.modalOpen || context.formFieldTarget) return undefined
  const id = findShortcut(event, bindings)
  const action = SHORTCUT_BINDINGS.find((binding) => shortcutId(binding.action) === id)?.action
  if (action === 'close-active' && !context.hasActiveTab) return undefined
  if ((action === 'next-tab' || action === 'previous-tab') && !context.tabCount) return undefined
  return action
}
