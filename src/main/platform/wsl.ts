import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '../../shared/errors'
import { resolveWslRoot } from './wsl-files'
export function parseWslList(bytes: Buffer): string[] {
  return bytes
    .toString('utf16le')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
}
export async function listWslDistributions(): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)('wsl.exe', ['--list', '--quiet'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    })
    return parseWslList(stdout)
  } catch {
    throw new AppError(
      'wsl-unavailable',
      'WSL недоступен. Проверьте установку и повторите попытку.',
      true,
    )
  }
}
export async function wslRoot(distribution: string): Promise<string> {
  return resolveWslRoot(distribution, async (name) => {
    const { stdout } = await promisify(execFile)(
      'wsl.exe',
      ['--distribution', name, '--exec', 'wslpath', '-w', '/'],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
    )
    return stdout
  })
}
