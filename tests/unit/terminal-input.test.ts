import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmoothInputQueue } from '../../src/renderer/src/features/terminal/SmoothInputQueue'

afterEach(() => vi.useRealTimers())

describe('SmoothInputQueue', () => {
  it('batches normal input, preserves ordering before control input, and flushes on demand', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const queue = new SmoothInputQueue((value) => sent.push(value), true)
    queue.write('abc')
    expect(sent).toEqual([])
    queue.write('\r')
    expect(sent).toEqual(['abc', '\r'])
    queue.write('def')
    queue.flush()
    expect(sent).toEqual(['abc', '\r', 'def'])
    queue.close()
  })

  it('drops pending input after close and sends directly when smoothing is disabled', () => {
    const sent: string[] = []
    const queue = new SmoothInputQueue((value) => sent.push(value), false)
    queue.write('now')
    queue.close()
    expect(sent).toEqual(['now'])
  })

  it('drains long text in bounded Unicode-safe chunks', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const queue = new SmoothInputQueue((value) => sent.push(value), true)
    queue.write('🙂'.repeat(65))
    vi.advanceTimersByTime(12)
    expect(sent).toEqual(['🙂'.repeat(64)])
    vi.advanceTimersByTime(12)
    expect(sent).toEqual(['🙂'.repeat(64), '🙂'])
    queue.close()
  })
})
