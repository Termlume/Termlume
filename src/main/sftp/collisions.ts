import { extname } from 'node:path'
import type { TransferJob } from './TransferQueue'
import { AppError } from '../../shared/errors'

export type CollisionChoice = 'replace' | 'skip' | 'keep-both' | 'cancel'
export async function withCollisions(
  request: TransferJob,
  signal: AbortSignal,
  run: (job: TransferJob) => Promise<void>,
): Promise<void> {
  const original = request.target
  let copy = 1
  for (;;) {
    signal.throwIfAborted()
    try {
      await run(request)
      return
    } catch (error) {
      const conflict = error as {
        code?: string
        targetVersion?: { size: number; modifiedAt: number }
      }
      if (
        !request.resolveCollision ||
        !['exists', 'destination-changed'].includes(conflict.code || '')
      )
        throw error
      const choice = await request.resolveCollision(request.target, signal)
      signal.throwIfAborted()
      if (choice === 'cancel') throw new AppError('canceled', 'Передача отменена пользователем')
      if (choice === 'skip') return
      if (choice === 'replace') {
        request.overwrite = true
        request.targetVersion = conflict.targetVersion
      } else {
        const extension = extname(original)
        request.target =
          original.slice(0, original.length - extension.length) + ` (${++copy})` + extension
        request.overwrite = false
        request.targetVersion = undefined
      }
    }
  }
}
