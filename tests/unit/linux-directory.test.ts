import { expect, it } from 'vitest'
import { terminalDirectoryPath } from '../../src/renderer/src/features/sftp/terminal-directory'

it('follows absolute and home-relative local Linux shell paths', () => {
  expect(terminalDirectoryPath('/home/demo/projects', '/home/demo', 'local')).toBe(
    '/home/demo/projects',
  )
  expect(terminalDirectoryPath('~/projects', '/home/demo', 'local')).toBe('/home/demo/projects')
  expect(terminalDirectoryPath('/tmp', 'C:\\Users\\demo', 'local')).toBeUndefined()
  expect(terminalDirectoryPath('relative', '/home/demo', 'local')).toBeUndefined()
})
