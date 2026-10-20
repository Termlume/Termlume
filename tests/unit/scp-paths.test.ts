import { expect, it } from 'vitest'
import { quotePosixShellPath } from '../../src/main/sftp/ScpService'
import { classifySftpOpenError } from '../../src/main/sftp/SftpService'

it('quotes a POSIX path as one literal shell argument', () => {
  expect(quotePosixShellPath("/srv/a file/'quoted'; $(touch nope)")).toBe(
    "'/srv/a file/'\"'\"'quoted'\"'\"'; $(touch nope)'",
  )
  expect(() => quotePosixShellPath('/bad\0path')).toThrow()
})

it('falls back only for an explicit unsupported SFTP subsystem reply', () => {
  expect(classifySftpOpenError(new Error('Unable to start subsystem: sftp'))).toMatchObject({
    code: 'sftp-unsupported',
  })
  const authentication = classifySftpOpenError(new Error('Authentication failed'))
  expect(authentication.code).not.toBe('sftp-unsupported')
  expect(authentication.message).toContain('Authentication failed')
  expect(classifySftpOpenError(new Error('Timed out waiting for subsystem')).code).not.toBe(
    'sftp-unsupported',
  )
})
