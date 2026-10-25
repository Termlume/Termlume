import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createAgent, utils, type BaseAgent, type ParsedKey } from 'ssh2'
import type { SshIdentity } from '../../shared/contracts'
import { parseOpenSshConfig } from './OpenSshConfig'
import { expandSshKeyPath } from './key-paths'

export interface DiscoverOptions {
  home?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  agentFactory?: (endpoint: string) => BaseAgent
}

function agentEndpoints(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  const endpoints = env.SSH_AUTH_SOCK ? [env.SSH_AUTH_SOCK] : []
  if (platform === 'win32') endpoints.push('\\\\.\\pipe\\openssh-ssh-agent', 'pageant')
  return [...new Set(endpoints)]
}

function queryAgent(endpoint: string, factory: (endpoint: string) => BaseAgent) {
  return new Promise<{ fingerprint: string }[]>((resolve) => {
    let finished = false
    const timer = setTimeout(() => finish([]), 1200)
    const finish = (value: { fingerprint: string }[]) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(value)
    }
    try {
      factory(endpoint).getIdentities((error, keys) => {
        if (error || !keys) return finish([])
        finish(
          keys.flatMap((entry) => {
            const raw =
              typeof entry === 'object' && entry !== null && 'pubKey' in entry
                ? entry.pubKey
                : entry
            const candidate =
              typeof raw === 'object' && raw !== null && 'pubKey' in raw ? raw.pubKey : raw
            const key =
              typeof candidate === 'object' && candidate !== null && 'getPublicSSH' in candidate
                ? (candidate as ParsedKey)
                : utils.parseKey(candidate as string | Buffer)
            if (key instanceof Error || Array.isArray(key)) return []
            return [
              {
                fingerprint:
                  'SHA256:' +
                  createHash('sha256')
                    .update(key.getPublicSSH())
                    .digest('base64')
                    .replace(/=+$/, ''),
              },
            ]
          }),
        )
      })
    } catch {
      finish([])
    }
  })
}

export async function discoverSshIdentities(options: DiscoverOptions = {}): Promise<SshIdentity[]> {
  const home = options.home || homedir(),
    platform = options.platform || process.platform,
    env = options.env || process.env,
    sshDir = join(home, '.ssh'),
    identities: SshIdentity[] = [],
    paths = new Set<string>()
  const addKey = async (path: string, label?: string) => {
    const expanded = expandSshKeyPath(path, home)
    if (paths.has(expanded)) return
    try {
      if (!(await stat(expanded)).isFile()) return
      paths.add(expanded)
      identities.push({
        id: randomUUID(),
        name: label || expanded.split(/[\\/]/).at(-1) || expanded,
        method: 'key',
        keyPath: expanded,
      })
    } catch {}
  }
  for (const name of ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa'])
    await addKey(join(sshDir, name))
  try {
    const config = parseOpenSshConfig(await readFile(join(sshDir, 'config'), 'utf8'))
    for (const host of config)
      for (const path of host.identityFiles)
        await addKey(path, `${host.patterns.join(', ')} · ${path}`)
  } catch {}
  const factory = options.agentFactory || createAgent
  for (const endpoint of agentEndpoints(platform, env)) {
    const keys = await queryAgent(endpoint, factory)
    keys.forEach(({ fingerprint }) =>
      identities.push({
        id: randomUUID(),
        name: `${endpoint === 'pageant' ? 'Pageant' : 'OpenSSH Agent'} · ${fingerprint}`,
        method: 'agent',
        agentEndpoint: endpoint,
        agentFingerprint: fingerprint,
      }),
    )
  }
  return identities
}
