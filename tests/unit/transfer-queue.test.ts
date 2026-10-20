import { it, expect } from 'vitest'
import { TransferQueue } from '../../src/main/sftp/TransferQueue'
const request = {
  sessionId: 'one',
  direction: 'upload' as const,
  source: 'source',
  target: 'target',
  overwrite: false,
  localRoot: 'root',
}
it('runsAtMostTwoPerSession', async () => {
  const completions: (() => void)[] = []
  const queue = new TransferQueue(
    async () => new Promise<void>((resolve) => completions.push(resolve)),
  )
  for (let index = 0; index < 4; index++) queue.enqueue({ ...request, target: 'target' + index })
  await Promise.resolve()
  expect(queue.list().filter((entry) => entry.state === 'running')).toHaveLength(2)
  await expect.poll(() => completions.length).toBe(2)
  completions.splice(0).forEach((resolve) => resolve())
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(queue.list().filter((entry) => entry.state === 'running')).toHaveLength(2)
  completions.splice(0).forEach((resolve) => resolve())
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(queue.list().filter((entry) => entry.state === 'completed')).toHaveLength(4)
})
it('cancelDoesNotMarkCompleted', async () => {
  const queue = new TransferQueue(
    async (_request, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
  )
  const id = queue.enqueue(request)
  await Promise.resolve()
  await queue.cancel(id)
  expect(queue.list().find((entry) => entry.id === id)?.state).toBe('canceled')
})
it('waitForResolvesOnlyAfterTheQueuedJobCompletes', async () => {
  let finish!: () => void
  const queue = new TransferQueue(
    async () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const id = queue.enqueue(request),
    completed = queue.waitFor(id)
  await expect.poll(() => queue.list().find((entry) => entry.id === id)?.state).toBe('running')
  finish()
  await expect(completed).resolves.toBeUndefined()
})
it('waitForRejectsWhenTheQueuedJobFailsOrIsCanceled', async () => {
  const failed = new TransferQueue(async () => {
      throw new Error('transfer failed')
    }),
    failureId = failed.enqueue(request)
  await expect(failed.waitFor(failureId)).rejects.toMatchObject({ code: expect.any(String) })
  const canceled = new TransferQueue(
      async (_request, signal) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    ),
    canceledId = canceled.enqueue(request),
    waiting = canceled.waitFor(canceledId)
  await Promise.resolve()
  await canceled.cancel(canceledId)
  await expect(waiting).rejects.toMatchObject({ code: 'canceled' })
})
it('disconnectFailsActiveAndCancelsQueued', async () => {
  const queue = new TransferQueue(
    async (_request, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
  )
  for (let index = 0; index < 3; index++) queue.enqueue({ ...request, target: 'target' + index })
  await Promise.resolve()
  await queue.closeSession('one')
  expect(queue.list().map((entry) => entry.state)).toEqual(['failed', 'failed', 'canceled'])
})
it('clearsOnlyCompletedHistoryForRequestedSession', async () => {
  let finish!: () => void
  const queue = new TransferQueue(async (job) => {
    if (job.target === 'running') await new Promise<void>((resolve) => (finish = resolve))
  })
  const first = queue.enqueue({ ...request, sessionId: 'one', target: 'completed' }),
    other = queue.enqueue({ ...request, sessionId: 'two', target: 'other' })
  await expect
    .poll(() => queue.list().filter((entry) => entry.state === 'completed'))
    .toHaveLength(2)
  const running = queue.enqueue({ ...request, sessionId: 'one', target: 'running' })
  await expect.poll(() => queue.list().find((entry) => entry.id === running)?.state).toBe('running')
  expect(queue.clearCompleted('one')).toBe(1)
  expect(queue.list().map((entry) => entry.id)).toEqual([other, running])
  expect(queue.list().find((entry) => entry.id === running)?.state).toBe('running')
  finish()
  await expect
    .poll(() => queue.list().find((entry) => entry.id === running)?.state)
    .toBe('completed')
  expect(queue.list().some((entry) => entry.id === first)).toBe(false)
})
