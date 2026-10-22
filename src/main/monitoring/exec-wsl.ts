import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '../../shared/errors'
const run = promisify(execFile)

// Separate non-interactive process: monitoring never writes into the user's PTY.
export async function execWslText(
  distribution: string,
  command: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new AppError('canceled', 'Опрос отменён')
  try {
    const { stdout } = await run(
      'wsl.exe',
      ['--distribution', distribution, '--exec', 'sh', '-c', command],
      {
        encoding: 'utf8',
        windowsHide: true,
        signal,
        timeout: 5000,
        maxBuffer: 1048576,
      },
    )
    return stdout
  } catch (error) {
    if (signal.aborted) throw new AppError('canceled', 'Опрос отменён')
    const failure = error as NodeJS.ErrnoException & { killed?: boolean }
    if (failure.killed) throw new AppError('monitor-timeout', 'Опрос WSL превысил 5 секунд', true)
    throw new AppError(
      'metric-command',
      'WSL не смог прочитать метрики. Проверьте доступность дистрибутива.',
      true,
    )
  }
}
