import { it, expect } from 'vitest'
import { validateSender, parseRequest } from '../../src/main/ipc/validate'

it('rejectsInvalidFrameAndPayload', () => {
  expect(() => validateSender('https://attacker.test', 'file:///app/index.html')).toThrow()
  expect(() => validateSender('file:///app/other.html', 'file:///app/index.html')).toThrow()
  expect(() => validateSender('file:///app/index.html', 'file:///app/index.html')).not.toThrow()
  for (const cols of [-1, NaN, Infinity])
    expect(() =>
      parseRequest({
        action: 'sessions.resize',
        id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
        cols,
        rows: 24,
      }),
    ).toThrow()
  expect(() => parseRequest({ action: 'sessions.close', id: '../../evil' })).toThrow()
  expect(() => parseRequest({ action: 'exec', command: 'anything' })).toThrow()
})

it('accepts bounded remote permission changes and rejects invalid octal modes', () => {
  const request = {
    action: 'files.mutate',
    side: 'remote',
    sessionId: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
    operation: 'chmod',
    path: '/home/tester/script.sh',
    permissions: 0o750,
  }
  expect(parseRequest(request)).toEqual(request)
  expect(() => parseRequest({ ...request, permissions: -1 })).toThrow()
  expect(() => parseRequest({ ...request, permissions: 0o10000 })).toThrow()
  expect(() => {
    const { permissions: _permissions, ...missingMode } = request
    return parseRequest(missingMode)
  }).toThrow()
})

it('accepts a validated remote ownership mutation and rejects shell-shaped principals', () => {
  const request = {
    action: 'files.mutate',
    side: 'remote',
    sessionId: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
    operation: 'chown',
    path: '/home/tester/script.sh',
    owner: 'deploy-user',
    group: 'web-team',
  }
  expect(parseRequest(request)).toEqual(request)
  expect(() => parseRequest({ ...request, owner: "deploy'; touch /tmp/pwn #" })).toThrow()
  expect(() => parseRequest({ ...request, group: '' })).toThrow()
})
