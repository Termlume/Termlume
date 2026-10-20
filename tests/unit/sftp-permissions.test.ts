import { expect, it } from 'vitest'
import {
  permissionsToRwx,
  rwxToPermissions,
} from '../../src/renderer/src/features/sftp/permissions'

it('convertsBetweenRwxAndOctalWhilePreservingSpecialBits', () => {
  expect(permissionsToRwx(0o4755)).toBe('rwxr-xr-x')
  expect(rwxToPermissions('rw-r-----', 0o4755)).toBe(0o4640)
  expect(permissionsToRwx(rwxToPermissions('rw-r-----', 0o4755))).toBe('rw-r-----')
})
