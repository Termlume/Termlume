import { requestSchema } from '../../shared/schemas'
import { AppError } from '../../shared/errors'
export function validateSender(actual: string | undefined, expected: string): void {
  if (!actual || actual.split('#')[0] !== expected.split('#')[0])
    throw new AppError('forbidden', 'Недопустимый источник запроса')
}
export function parseRequest(input: unknown) {
  return requestSchema.parse(input)
}
