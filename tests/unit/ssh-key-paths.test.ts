import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandSshKeyPath, sshKeyPickerDirectory } from '../../src/main/ssh/key-paths'

let home: string | undefined
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true })
})

it('expands home-relative key paths independently of the application working directory', () => {
  const base = join(tmpdir(), 'alice'),
    absolute = join(tmpdir(), 'custom key')
  expect(expandSshKeyPath('~/.ssh/company key', base)).toBe(join(base, '.ssh/company key'))
  expect(expandSshKeyPath('%d/.ssh/id_ed25519', base)).toBe(join(base, '.ssh/id_ed25519'))
  expect(expandSshKeyPath('.ssh/id_rsa', base)).toBe(join(base, '.ssh/id_rsa'))
  expect(expandSshKeyPath(absolute, base)).toBe(absolute)
})

it('opens the picker in ~/.ssh, falling back to home when that folder is absent', async () => {
  home = await mkdtemp(join(tmpdir(), 'ssh-picker-'))
  expect(await sshKeyPickerDirectory(home)).toBe(home)
  await mkdir(join(home, '.ssh'))
  expect(await sshKeyPickerDirectory(home)).toBe(join(home, '.ssh'))
})
