import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function supportsAutoUpdate(options: {
  platform: string
  packaged: boolean
  development: boolean
  customData: boolean
  executable: string
  resources: string
  env: NodeJS.ProcessEnv
}) {
  if (!options.packaged || options.development || options.customData) return false
  if (options.platform === 'win32')
    return existsSync(join(dirname(options.executable), 'Uninstall Termlume.exe'))
  if (options.platform !== 'linux') return false
  if (options.env.APPIMAGE && existsSync(options.env.APPIMAGE)) return true
  try {
    return readFileSync(join(options.resources, 'package-type'), 'utf8').trim() === 'deb'
  } catch {
    return false
  }
}
