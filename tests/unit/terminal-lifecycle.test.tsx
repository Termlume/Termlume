import { it, expect } from 'vitest'
import { SessionOutputRouter } from '../../src/renderer/src/features/terminal/SessionOutputRouter'
it('queuesEarlyOutputAndUnsubscribesWithoutLosingOrder', () => {
  const router = new SessionOutputRouter(),
    received: number[] = []
  router.push('one', new Uint8Array([1]), 1)
  const off = router.subscribe('one', (bytes) => received.push(...bytes))
  router.push('two', new Uint8Array([9]), 2)
  router.push('one', new Uint8Array([2]), 3)
  off()
  router.push('one', new Uint8Array([3]), 4)
  expect(received).toEqual([1, 2])
  router.subscribe('one', (bytes) => received.push(...bytes))
  expect(received).toEqual([1, 2, 3])
  router.remove('one')
})
