import type { SafeError } from './contracts'
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message)
  }
}
export function safeError(error: unknown): SafeError {
  if (error instanceof AppError)
    return { code: error.code, message: error.message, retryable: error.retryable }
  const code = (error as { code?: string })?.code || 'operation-failed'
  const messages: Record<string, string> = {
    ENOTFOUND: 'Адрес сервера не найден',
    ECONNREFUSED: 'Сервер отклонил подключение',
    ETIMEDOUT: 'Сервер не ответил вовремя',
    ENOENT: 'Файл не найден',
    EACCES: 'Недостаточно прав',
    ECONNRESET: 'Соединение разорвано',
  }
  return { code, message: messages[code] || 'Не удалось выполнить операцию', retryable: true }
}
