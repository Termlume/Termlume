import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '../../shared/errors'
import { resolveWslRoot } from './wsl-files'
import type { WslDistribution } from '../../shared/contracts'
export function parseWslInventory(bytes: Buffer): WslDistribution[] {
  const rows = bytes.toString('utf16le').replace(/\0/g, '').split(/\r?\n/)
  return rows.flatMap((row) => {
    const match = /^\s*(\*)?\s*(.+?)\s{2,}(.+?)\s{2,}([12])\s*$/.exec(row)
    return match
      ? [
          {
            name: match[2].trim(),
            isDefault: !!match[1],
            state: match[3].trim(),
            version: Number(match[4]) as 1 | 2,
          },
        ]
      : []
  })
}
export async function listWslInventory(): Promise<WslDistribution[]> {
  try {
    const { stdout } = await promisify(execFile)('wsl.exe', ['--list', '--verbose'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    })
    return parseWslInventory(stdout)
  } catch {
    throw new AppError(
      'wsl-unavailable',
      'WSL недоступен. Проверьте установку и повторите попытку.',
      true,
    )
  }
}
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
