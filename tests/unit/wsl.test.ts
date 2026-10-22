import { it, expect } from 'vitest'
import { parseWslList, parseWslInventory } from '../../src/main/platform/wsl'
it('parsesUtf16WslList', () =>
  expect(parseWslList(Buffer.from('Ubuntu-24.04\r\nUbuntu\r\n\r\n', 'utf16le'))).toEqual([
    'Ubuntu-24.04',
    'Ubuntu',
  ]))
it('reads the Windows default marker, localized state and version without starting distributions', () => {
  expect(
    parseWslInventory(
      Buffer.from(
        '  NAME             STATE           VERSION\r\n* Ubuntu-24.04     Running         2\r\n  Debian           Остановлено     1\r\n',
        'utf16le',
      ),
    ),
  ).toEqual([
    { name: 'Ubuntu-24.04', isDefault: true, state: 'Running', version: 2 },
    { name: 'Debian', isDefault: false, state: 'Остановлено', version: 1 },
  ])
})
