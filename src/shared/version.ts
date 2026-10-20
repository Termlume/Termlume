import manifest from '../../package.json'

export const APP_DISPLAY_VERSION = manifest.displayVersion || manifest.version
export function displayVersion(version?: string): string {
  return version === manifest.version ? APP_DISPLAY_VERSION : (version ?? '')
}
