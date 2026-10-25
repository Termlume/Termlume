import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supportsAutoUpdate } from '../../src/main/updates/update-support'

const root = mkdtempSync(join(tmpdir(), 'termlume-update-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('enables installed DEB and AppImage but keeps development and portable folders disabled', () => {
  mkdirSync(root, { recursive: true })
  const options = {
    platform: 'linux',
    packaged: true,
    development: false,
    customData: false,
    executable: join(root, 'termlume'),
    resources: root,
    env: {},
  }
  expect(supportsAutoUpdate(options)).toBe(false)
  writeFileSync(join(root, 'package-type'), 'deb\n')
  expect(supportsAutoUpdate(options)).toBe(true)
  expect(supportsAutoUpdate({ ...options, customData: true })).toBe(false)
  expect(supportsAutoUpdate({ ...options, development: true })).toBe(false)
  expect(supportsAutoUpdate({ ...options, packaged: false })).toBe(false)
  writeFileSync(join(root, 'package-type'), 'rpm')
  expect(supportsAutoUpdate(options)).toBe(false)
  const image = join(root, 'Termlume.AppImage')
  writeFileSync(image, '')
  expect(supportsAutoUpdate({ ...options, env: { APPIMAGE: image } })).toBe(true)
})
it('preserves the installed Windows requirement', () => {
  mkdirSync(root, { recursive: true })
  const options = {
    platform: 'win32',
    packaged: true,
    development: false,
    customData: false,
    executable: join(root, 'Termlume.exe'),
    resources: root,
    env: {},
  }
  expect(supportsAutoUpdate(options)).toBe(false)
  writeFileSync(join(root, 'Uninstall Termlume.exe'), '')
  expect(supportsAutoUpdate(options)).toBe(true)
})
