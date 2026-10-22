import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type WslHomeQuery = (distribution: string) => Promise<string>
const queryHome: WslHomeQuery = async (distribution) => {
  const { stdout } = await promisify(execFile)(
    'wsl.exe',
    ['--distribution', distribution, '--exec', 'sh', '-c', 'printf %s "$HOME"'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 4096 },
  )
  return stdout
}

/** Read the default user's actual HOME without sending commands to the terminal PTY. */
export async function wslHomeDirectory(
  distribution: string,
  root: string,
  run: WslHomeQuery = queryHome,
): Promise<string> {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\/]+)$/i.exec(root)
  if (!match || match[1].toLowerCase() !== distribution.toLowerCase()) return root
  try {
    const home = await run(distribution)
    if (!home.startsWith('/') || home.length > 4096 || /[\\:\x00-\x1f\x7f]/.test(home)) return root
    const segments = home.split('/').filter(Boolean)
    if (segments.some((segment) => segment === '.' || segment === '..')) return root
    return segments.length ? root + '\\' + segments.join('\\') : root
  } catch {
    return root
  }
}
