import { randomUUID } from 'node:crypto'
import type { AdapterEvent, AuthAnswer, TrustAnswer } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
type Details = Extract<AdapterEvent, { type: 'challenge' }>['challenge']
type Answer = AuthAnswer | TrustAnswer
export class SshChallenges {
  private pending = new Map<
    string,
    {
      ownerId: number
      kind: Details['kind']
      resolve: (value: Answer) => void
      reject: (error: Error) => void
      cleanup: () => void
    }
  >()
  request(
    ownerId: number,
    sessionId: string,
    details: Omit<Details, 'id'>,
    signal: AbortSignal,
    emit: (event: AdapterEvent) => void,
  ): Promise<Answer> {
    if (signal.aborted) return Promise.reject(new AppError('canceled', 'Подключение отменено'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const abort = () => {
        this.pending.delete(id)
        reject(new AppError('canceled', 'Подключение отменено'))
      }
      const cleanup = () => signal.removeEventListener('abort', abort)
      this.pending.set(id, { ownerId, kind: details.kind, resolve, reject, cleanup })
      signal.addEventListener('abort', abort, { once: true })
      emit({
        type: 'state',
        state: details.kind === 'auth' ? 'awaiting-auth' : 'awaiting-host-verification',
      })
      emit({ type: 'challenge', challenge: { ...details, id } })
    })
  }
  answer(ownerId: number, id: string, answer: Answer): void {
    const pending = this.pending.get(id)
    if (!pending || pending.ownerId !== ownerId || pending.kind !== answer.kind)
      throw new AppError('invalid-challenge', 'Запрос уже закрыт или недоступен')
    this.pending.delete(id)
    pending.cleanup()
    pending.resolve(answer)
  }
}
