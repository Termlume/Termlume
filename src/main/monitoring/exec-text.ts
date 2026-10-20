import type { Client, ClientChannel } from 'ssh2'
import { AppError } from '../../shared/errors'
export function execText(client: Client, command: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined,
      output: Buffer[] = [],
      bytes = 0,
      finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) {
        channel?.close()
        reject(error)
      } else resolve(Buffer.concat(output).toString('utf8'))
    }
    const abort = () => finish(new AppError('canceled', 'Опрос отменён'))
    const timer = setTimeout(
      () => finish(new AppError('monitor-timeout', 'Опрос сервера превысил 5 секунд', true)),
      5000,
    )
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      client.exec(command, (error, stream) => {
        if (error) {
          finish(new AppError('exec-denied', 'Сервер не разрешил сбор метрик', true))
          return
        }
        channel = stream
        if (finished || signal.aborted) {
          stream.close()
          return
        }
        const consume = (data: Buffer) => {
          bytes += data.length
          if (bytes > 1048576) {
            finish(new AppError('metric-limit', 'Ответ метрик слишком большой'))
            return
          }
          output.push(data)
        }
        stream.on('data', consume)
        stream.stderr.on('data', (data: Buffer) => {
          bytes += data.length
          if (bytes > 1048576) finish(new AppError('metric-limit', 'Ответ метрик слишком большой'))
        })
        stream.on('error', () =>
          finish(new AppError('monitor-channel', 'Канал мониторинга закрыт', true)),
        )
        stream.on('close', (code: number | undefined) =>
          finish(
            code && code !== 0
              ? new AppError('metric-command', 'Сервер не смог прочитать метрики', true)
              : undefined,
          ),
        )
      })
    } catch (error) {
      finish(error as Error)
    }
  })
}
