export interface OpenSshHostConfig {
  patterns: string[]
  hostname?: string
  user?: string
  port?: number
  identityFiles: string[]
  identitiesOnly?: boolean
}

export function parseOpenSshConfig(text: string): OpenSshHostConfig[] {
  const hosts: OpenSshHostConfig[] = []
  let current: OpenSshHostConfig | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([\w]+)\s+(.+)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase(),
      value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (key === 'host') {
      current = { patterns: value.split(/\s+/), identityFiles: [] }
      hosts.push(current)
      continue
    }
    if (!current) continue
    if (key === 'hostname' && !current.hostname) current.hostname = value
    else if (key === 'user' && !current.user) current.user = value
    else if (key === 'port' && !current.port && /^\d+$/.test(value)) {
      const port = Number(value)
      if (port >= 1 && port <= 65535) current.port = port
    } else if (key === 'identityfile') current.identityFiles.push(value)
    else if (key === 'identitiesonly' && current.identitiesOnly === undefined)
      current.identitiesOnly = /^(yes|true|1)$/i.test(value)
  }
  return hosts
}
