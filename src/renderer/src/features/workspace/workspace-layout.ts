export type SplitAxis = 'horizontal' | 'vertical'
export type WorkspaceLayout =
  | { type: 'leaf'; sessionId: string }
  | {
      type: 'split'
      axis: SplitAxis
      ratio: number
      first: WorkspaceLayout
      second: WorkspaceLayout
    }

export type LayoutPreset = 'one' | 'two-vertical' | 'two-horizontal' | 'four'

const MIN_RATIO = 0.15
const MAX_RATIO = 0.85
const MAX_PANES = 4

export function clampRatio(ratio: number) {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Number.isFinite(ratio) ? ratio : 0.5))
}

export function createLayout(sessionId: string): WorkspaceLayout {
  return { type: 'leaf', sessionId }
}

export function splitLayout(
  firstId: string,
  secondId: string,
  axis: SplitAxis = 'vertical',
  ratio = 0.5,
): WorkspaceLayout {
  return {
    type: 'split',
    axis,
    ratio: clampRatio(ratio),
    first: createLayout(firstId),
    second: createLayout(secondId),
  }
}

export function buildPresetLayout(
  sessionIds: string[],
  activeId: string | undefined,
  preset: LayoutPreset,
): WorkspaceLayout | undefined {
  const unique = [...new Set(sessionIds)]
  if (!unique.length) return undefined
  const activeIndex = activeId ? unique.indexOf(activeId) : -1
  if (activeIndex > 0) unique.unshift(unique.splice(activeIndex, 1)[0])
  if (preset === 'one' || unique.length === 1) return createLayout(unique[0])

  const count = preset === 'four' ? Math.min(4, unique.length) : 2
  const ids = unique.slice(0, count)
  if (preset === 'two-vertical') return splitLayout(ids[0], ids[1], 'vertical')
  if (preset === 'two-horizontal') return splitLayout(ids[0], ids[1], 'horizontal')
  if (ids.length === 2) return splitLayout(ids[0], ids[1], 'vertical')
  const combine = (first: WorkspaceLayout, second: WorkspaceLayout, axis: SplitAxis) => ({
    type: 'split' as const,
    axis,
    ratio: 0.5,
    first,
    second,
  })
  if (ids.length === 3)
    return combine(createLayout(ids[0]), splitLayout(ids[1], ids[2], 'horizontal'), 'vertical')
  return combine(
    splitLayout(ids[0], ids[1], 'horizontal'),
    splitLayout(ids[2], ids[3], 'horizontal'),
    'vertical',
  )
}

export function findSessions(layout?: WorkspaceLayout): string[] {
  if (!layout) return []
  return layout.type === 'leaf'
    ? [layout.sessionId]
    : [...findSessions(layout.first), ...findSessions(layout.second)]
}

export function swapSessions(
  layout: WorkspaceLayout | undefined,
  firstId: string,
  secondId: string,
): WorkspaceLayout | undefined {
  if (!layout || firstId === secondId) return layout
  const replace = (node: WorkspaceLayout): WorkspaceLayout => {
    if (node.type === 'leaf')
      return {
        ...node,
        sessionId:
          node.sessionId === firstId
            ? secondId
            : node.sessionId === secondId
              ? firstId
              : node.sessionId,
      }
    return { ...node, first: replace(node.first), second: replace(node.second) }
  }
  return replace(layout)
}

export function addSession(
  layout: WorkspaceLayout | undefined,
  sessionId: string,
  axis: SplitAxis = 'vertical',
): WorkspaceLayout | undefined {
  if (!sessionId || findSessions(layout).includes(sessionId)) return layout
  if (!layout) return createLayout(sessionId)
  if (findSessions(layout).length >= MAX_PANES) return layout
  return { type: 'split', axis, ratio: 0.5, first: layout, second: createLayout(sessionId) }
}

export function removeSession(
  layout: WorkspaceLayout | undefined,
  sessionId: string,
): WorkspaceLayout | undefined {
  if (!layout) return undefined
  if (layout.type === 'leaf') return layout.sessionId === sessionId ? undefined : layout
  const first = removeSession(layout.first, sessionId),
    second = removeSession(layout.second, sessionId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}

export function validateLayout(layout: unknown): layout is WorkspaceLayout {
  const seen = new Set<string>()
  const walk = (value: unknown): value is WorkspaceLayout => {
    if (!value || typeof value !== 'object') return false
    const node = value as Record<string, unknown>
    if (node.type === 'leaf') {
      if (typeof node.sessionId !== 'string' || !node.sessionId || seen.has(node.sessionId))
        return false
      seen.add(node.sessionId)
      return seen.size <= MAX_PANES
    }
    return (
      node.type === 'split' &&
      (node.axis === 'horizontal' || node.axis === 'vertical') &&
      typeof node.ratio === 'number' &&
      node.ratio >= MIN_RATIO &&
      node.ratio <= MAX_RATIO &&
      walk(node.first) &&
      walk(node.second)
    )
  }
  return walk(layout)
}
