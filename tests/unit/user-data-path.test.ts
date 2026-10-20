import { describe, expect, it } from 'vitest'
import { resolveUserDataPath } from '../../src/main/storage/user-data-path'
import { join, resolve } from 'node:path'

describe('resolveUserDataPath', () => {
  it('keeps the legacy Terminal directory after product rename', () => {
    expect(resolveUserDataPath(join('C:/Users/me/AppData/Roaming'))).toBe(
      join('C:/Users/me/AppData/Roaming', 'Terminal'),
    )
  })

  it('honors an explicit user data directory override', () => {
    expect(resolveUserDataPath('C:/Users/me/AppData/Roaming', 'D:/Termlume-data')).toBe(
      resolve('D:/Termlume-data'),
    )
  })
})
