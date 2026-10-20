import { join, resolve } from 'node:path'

/** Keep user data in the original Terminal directory across the product rename. */
export function resolveUserDataPath(appDataPath: string, override?: string): string {
  return override ? resolve(override) : join(appDataPath, 'Terminal')
}
