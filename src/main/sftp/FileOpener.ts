import { spawn, execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app, shell } from 'electron'

export type FileOpenMode = 'default' | 'choose' | 'text'

/** Matches shell.openPath: an empty string means launched successfully or chooser cancelled. */
export async function openFile(path: string, mode: FileOpenMode = 'default'): Promise<string> {
  try {
    if (!isAbsolute(path) || !(await stat(path)).isFile())
      return 'Для открытия нужен существующий файл с абсолютным путём'
    if (mode === 'default' || process.platform !== 'win32') return await shell.openPath(path)
    if (mode === 'text') {
      return await new Promise<string>((resolve) => {
        const child = spawn(
          join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'),
          [path],
          {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          },
        )
        child.once('error', (error) => resolve('Не удалось открыть Блокнот: ' + error.message))
        child.once('spawn', () => {
          child.unref()
          resolve('')
        })
      })
    }
    const executable = app.isPackaged
      ? join(process.resourcesPath, 'native', 'Termlume.FileDrag.exe')
      : join(app.getAppPath(), 'native', 'windows-drag', 'bin', 'Termlume.FileDrag.exe')
    return await new Promise<string>((resolve) => {
      execFile(
        executable,
        ['--open-with', path],
        { shell: false, windowsHide: true, encoding: 'utf8' },
        (error, stdout) => {
          if (!error) return resolve('')
          let message = error.message
          try {
            const response = JSON.parse(stdout.trim())
            if (typeof response.error === 'string') message = response.error
          } catch {
            /* An OS launch failure has no helper JSON response. */
          }
          resolve('Не удалось открыть выбор приложения: ' + message)
        },
      )
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
