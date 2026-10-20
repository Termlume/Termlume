import { it, expect } from 'vitest'
import { parseWslList } from '../../src/main/platform/wsl'
it('parsesUtf16WslList', () =>
  expect(parseWslList(Buffer.from('Ubuntu-24.04\r\nUbuntu\r\n\r\n', 'utf16le'))).toEqual([
    'Ubuntu-24.04',
    'Ubuntu',
  ]))
