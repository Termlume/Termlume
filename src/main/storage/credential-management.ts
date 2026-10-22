import type { HostProfile, SshIdentity } from '../../shared/contracts'

export function sameCredentialBinding(
  previous: HostProfile | SshIdentity,
  current: HostProfile | SshIdentity | undefined,
): boolean {
  if (!current) return false
  const keys = [
    'protocol',
    'host',
    'port',
    'username',
    'auth',
    'method',
    'identityId',
    'keyPath',
    'secretRef',
    'agentEndpoint',
    'agentFingerprint',
    'security',
  ]
  return keys.every(
    (key) =>
      (previous as unknown as Record<string, unknown>)[key] ===
      (current as unknown as Record<string, unknown>)[key],
  )
}

export function secretReferenceIsShared(
  reference: string,
  owner: { hostId: string } | { identityId: string },
  hosts: HostProfile[],
  identities: SshIdentity[],
): boolean {
  if (
    identities.some(
      (identity) =>
        (!('identityId' in owner) || identity.id !== owner.identityId) &&
        (identity.secretRef || identity.id) === reference,
    )
  )
    return true
  return hosts.some((host) => {
    if ('hostId' in owner && host.id === owner.hostId) return false
    if ('identityId' in owner && 'identityId' in host && host.identityId === owner.identityId)
      return false
    return 'secretRef' in host && (host.secretRef || host.id) === reference
  })
}

export function removeCredentialLinks(
  hosts: HostProfile[],
  identity: SshIdentity,
  options: { replacementId?: string; detach?: boolean; confirmMerge?: boolean },
  replacement?: SshIdentity,
): HostProfile[] {
  const linked = hosts.some((host) => 'identityId' in host && host.identityId === identity.id)
  if (
    options.replacementId &&
    (!replacement || replacement.id === identity.id || !options.confirmMerge)
  )
    throw new Error('Подтвердите объединение с другими учётными данными')
  if (linked && !replacement && !options.detach)
    throw new Error('Выберите замену или отключение связанных подключений')
  return hosts.map((host) => {
    if (!('identityId' in host) || host.identityId !== identity.id) return host
    if (replacement)
      return {
        ...host,
        identityId: replacement.id,
        username: replacement.username || host.username,
        auth: replacement.method === 'password' ? 'password' : 'key',
        keyPath: replacement.keyPath,
        agentEndpoint: undefined,
        agentFingerprint: undefined,
        secretRef: undefined,
      }
    return {
      ...host,
      identityId: undefined,
      username: identity.username || host.username,
      auth: identity.method === 'password' ? 'password' : 'key',
      keyPath: identity.keyPath,
      agentEndpoint: identity.agentEndpoint,
      agentFingerprint: identity.agentFingerprint,
      secretRef: identity.secretRef || host.secretRef,
    }
  }) as HostProfile[]
}
