import { join, resolve } from 'node:path'

/** Keep user data in the original Terminal directory across the product rename. */
export function resolveUserDataPath(
  appDataPath: string,
  override?: string,
  platform: string = process.platform,
): string {
  return override
    ? resolve(override)
    : join(appDataPath, platform === 'linux' ? 'Termlume' : 'Terminal')
}
