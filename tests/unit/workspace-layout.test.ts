import { afterEach, expect, it } from 'vitest'
import {
  addSession,
  buildPresetLayout,
  clampRatio,
  createLayout,
  findSessions,
  removeSession,
  swapSessions,
  splitLayout,
  validateLayout,
  type WorkspaceLayout,
} from '../../src/renderer/src/features/workspace/workspace-layout'

afterEach(() => {})

it('builds one-, two-orientation, and four-pane presets with the active tab first', () => {
  expect(findSessions(buildPresetLayout(['a', 'b', 'c', 'd'], 'c', 'one'))).toEqual(['c'])
  expect(buildPresetLayout(['a', 'b', 'c'], 'b', 'two-vertical')).toMatchObject({
    type: 'split',
    axis: 'vertical',
    first: { type: 'leaf', sessionId: 'b' },
    second: { type: 'leaf', sessionId: 'a' },
  })
  expect(buildPresetLayout(['a', 'b', 'c'], 'b', 'two-horizontal')).toMatchObject({
    type: 'split',
    axis: 'horizontal',
  })
  expect(buildPresetLayout(['a', 'b', 'c', 'd'], 'd', 'four')).toMatchObject({
    type: 'split',
    axis: 'vertical',
    first: { type: 'split', axis: 'horizontal' },
    second: { type: 'split', axis: 'horizontal' },
  })
})

it('caps preset panes to unique available sessions and handles an empty list', () => {
  const layout = buildPresetLayout(['a', 'a', 'b', 'c'], 'b', 'four')
  expect(findSessions(layout)).toEqual(['b', 'a', 'c'])
  expect(new Set(findSessions(layout)).size).toBe(3)
  expect(buildPresetLayout([], undefined, 'four')).toBeUndefined()
})

it('adds and removes sessions while normalizing the empty and single-session layouts', () => {
  let layout: WorkspaceLayout | undefined = createLayout('one')
  layout = addSession(layout, 'two')
  expect(findSessions(layout)).toEqual(['one', 'two'])
  layout = removeSession(layout, 'two')
  expect(layout).toEqual({ type: 'leaf', sessionId: 'one' })
  expect(removeSession(layout, 'one')).toBeUndefined()
})

it('preserves split direction and clamps ratios to the supported range', () => {
  expect(clampRatio(0)).toBe(0.15)
  expect(clampRatio(1)).toBe(0.85)
  const layout = splitLayout('one', 'two', 'vertical', 0.6)
  expect(layout).toMatchObject({ type: 'split', axis: 'vertical', ratio: 0.6 })
})

it('swapsSplitSessionLeavesWithoutChangingTheLayoutRatios', () => {
  const layout = splitLayout('a', 'b', 'vertical', 0.37)
  const swapped = swapSessions(layout, 'a', 'b')!
  expect(findSessions(swapped)).toEqual(['b', 'a'])
  expect(swapped).toMatchObject({ axis: 'vertical', ratio: 0.37 })
})

it('limits workspace to four unique panes and rejects duplicate references', () => {
  let layout: WorkspaceLayout | undefined = createLayout('one')
  for (const id of ['two', 'three', 'four']) layout = addSession(layout, id)
  expect(findSessions(layout)).toHaveLength(4)
  expect(addSession(layout, 'five')).toBe(layout)
  expect(addSession(layout, 'four')).toBe(layout)
  expect(
    validateLayout({
      type: 'split',
      axis: 'horizontal',
      ratio: 0.5,
      first: createLayout('x'),
      second: createLayout('x'),
    }),
  ).toBe(false)
})
