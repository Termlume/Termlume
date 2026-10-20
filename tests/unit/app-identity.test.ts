import { expect, it } from 'vitest'
import { WINDOWS_APP_USER_MODEL_ID } from '../../src/main/platform/app-identity'

it('preserves the stable Windows application identity across product renames', () => {
  expect(WINDOWS_APP_USER_MODEL_ID).toBe('local.personalterminal.app')
})
