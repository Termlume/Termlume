import { describe, expect, it } from 'vitest'
import {
  removeCredentialLinks,
  secretReferenceIsShared,
  sameCredentialBinding,
} from '../../src/main/storage/credential-management'
import type { HostProfile, SshIdentity } from '../../src/shared/contracts'
const credential: SshIdentity = {
  id: 'credential',
  name: 'Компания',
  username: 'shared-login',
  method: 'key',
  keyPath: 'C:/key',
  secretRef: 'protected-reference',
}
const hosts = [1, 2].map((id) => ({
  id: String(id),
  name: `Host ${id}`,
  protocol: 'ssh',
  host: 'server',
  port: 22,
  username: 'old-login',
  auth: 'password',
  identityId: credential.id,
  secretRef: 'stale-host-secret',
  monitoringEnabled: true,
})) as HostProfile[]
describe('credential removal safety', () => {
  it('rejects stale or deleted authentication bindings while allowing fresh display metadata', () => {
    expect(sameCredentialBinding(credential, { ...credential, name: 'Renamed' })).toBe(true)
    for (const patch of [
      { username: 'another' },
      { method: 'password' },
      { keyPath: 'C:/other' },
      { secretRef: 'new-ref' },
    ])
      expect(sameCredentialBinding(credential, { ...credential, ...patch } as SshIdentity)).toBe(
        false,
      )
    expect(sameCredentialBinding(credential, undefined)).toBe(false)
    expect(sameCredentialBinding(hosts[0], { ...hosts[0], name: 'Renamed server' })).toBe(true)
    expect(
      sameCredentialBinding(hosts[0], { ...hosts[0], identityId: 'replacement' } as HostProfile),
    ).toBe(false)
  })
  it('isolates an own-host password write from a legacy saved credential alias', () => {
    const identity = { ...credential, secretRef: '1' }
    expect(secretReferenceIsShared('1', { hostId: '1' }, hosts, [identity])).toBe(true)
    expect(secretReferenceIsShared('1', { hostId: '1' }, hosts, [])).toBe(false)
  })
  it('isolates a shared password write from an independent host while retaining linked-host sharing', () => {
    const identity = { ...credential, secretRef: '1' }
    expect(secretReferenceIsShared('1', { identityId: identity.id }, hosts, [identity])).toBe(false)
    const detached = { ...hosts[0], identityId: undefined, secretRef: '1' } as HostProfile
    expect(
      secretReferenceIsShared('1', { identityId: identity.id }, [detached, hosts[1]], [identity]),
    ).toBe(true)
  })
  it('protects vault bytes referenced by another saved identity or detached host', () => {
    const identity = { ...credential, secretRef: 'legacy-ref' }
    const duplicate = { ...identity, id: 'duplicate' }
    expect(
      secretReferenceIsShared('legacy-ref', { identityId: identity.id }, hosts, [
        identity,
        duplicate,
      ]),
    ).toBe(true)
    const detached = { ...hosts[1], identityId: undefined, secretRef: 'legacy-ref' } as HostProfile
    expect(secretReferenceIsShared('legacy-ref', { hostId: '1' }, [hosts[0], detached], [])).toBe(
      true,
    )
  })
  it('requires an explicit decision for linked hosts', () => {
    expect(() => removeCredentialLinks(hosts, credential, {})).toThrow('Выберите замену')
    expect(hosts[0]).toHaveProperty('identityId', credential.id)
  })
  it('detaches every linked host while retaining its effective login, key and secret reference', () => {
    const detached = removeCredentialLinks(hosts, credential, { detach: true })
    for (const host of detached)
      expect(host).toMatchObject({
        identityId: undefined,
        username: 'shared-login',
        auth: 'key',
        keyPath: 'C:/key',
        secretRef: 'protected-reference',
      })
    expect(hosts[0]).toHaveProperty('identityId', credential.id)
  })
  it('requires explicit merge confirmation and removes stale per-host secrets on reassignment', () => {
    const replacement: SshIdentity = {
      id: 'other',
      name: 'Другая компания',
      username: 'new-login',
      method: 'password',
    }
    expect(() =>
      removeCredentialLinks(hosts, credential, { replacementId: 'other' }, replacement),
    ).toThrow('Подтвердите')
    const merged = removeCredentialLinks(
      hosts,
      credential,
      { replacementId: 'other', confirmMerge: true },
      replacement,
    )
    for (const host of merged)
      expect(host).toMatchObject({
        identityId: 'other',
        username: 'new-login',
        secretRef: undefined,
      })
  })
})
