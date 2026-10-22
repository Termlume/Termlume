import { it, expect } from 'vitest'
import { APP_DISPLAY_VERSION, displayVersion } from '../../src/shared/version'
it('shows the current release version and preserves other channel versions', () => {
  expect(APP_DISPLAY_VERSION).toBe('0.2.2')
  expect(displayVersion('0.2.2')).toBe('0.2.2')
  expect(displayVersion('0.1.0-alpha.4')).toBe('0.1.0-alpha.4')
  expect(displayVersion(undefined)).toBe('')
})
