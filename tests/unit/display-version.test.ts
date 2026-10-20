import { it, expect } from 'vitest'
import { APP_DISPLAY_VERSION, displayVersion } from '../../src/shared/version'
it('labels the public beta while keeping the stable-compatible internal version', () => {
  expect(APP_DISPLAY_VERSION).toBe('0.2.1b')
  expect(displayVersion('0.2.1')).toBe('0.2.1b')
  expect(displayVersion('0.1.0-alpha.4')).toBe('0.1.0-alpha.4')
  expect(displayVersion(undefined)).toBe('')
})
