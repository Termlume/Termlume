import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'

export function expandSshKeyPath(value: string, home = homedir()) {
  const expanded =
    value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value
  return resolve(
    home,
    expanded.replace(/%d/g, () => home),
  )
}

export async function sshKeyPickerDirectory(home = homedir()) {
  const directory = join(home, '.ssh')
  try {
    if ((await stat(directory)).isDirectory()) return directory
  } catch {}
  return home
}
