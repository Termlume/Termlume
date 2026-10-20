import { expect, it } from 'vitest'
import { orderedGroups, moveGroup } from '../../src/renderer/src/features/hosts/group-order'
import { settingsSchema, settingsPatchSchema } from '../../src/shared/schemas'
it('orders known groups, skips deleted groups and appends new ones', () => {
  expect(orderedGroups(['A', 'B', 'A', '', 'C'], ['B', 'deleted', 'A', 'B'])).toEqual([
    'B',
    'A',
    '',
    'C',
  ])
})
it('moves before and after targets without losing filtered groups or the ungrouped bucket', () => {
  expect(moveGroup(['A', 'B', '', 'C'], 'C', 'A', 'before')).toEqual(['C', 'A', 'B', ''])
  expect(moveGroup(['A', 'B', '', 'C'], 'A', 'C', 'after')).toEqual(['B', '', 'C', 'A'])
  expect(moveGroup(['A', 'B', '', 'C'], '', 'B', 'before')).toEqual(['A', '', 'B', 'C'])
  expect(moveGroup(['A', 'B'], 'X', 'A', 'after')).toEqual(['A', 'B'])
  expect(moveGroup(['A', 'B'], 'A', 'A', 'after')).toEqual(['A', 'B'])
})
it('migrates old settings without overwriting order on unrelated patches', () => {
  expect(settingsSchema.parse({}).hostGroupOrder).toEqual([])
  expect(settingsPatchSchema.parse({ themeId: 'catppuccin-latte' })).not.toHaveProperty(
    'hostGroupOrder',
  )
  expect(settingsPatchSchema.parse({ hostGroupOrder: ['B', 'A', ''] }).hostGroupOrder).toEqual([
    'B',
    'A',
    '',
  ])
})
