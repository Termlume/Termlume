import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, join, relative, resolve, isAbsolute, posix } from 'node:path'
import { serveSftp } from './sftp-server'
export async function sshFixture(
  options: {
    shellGreeting?: string
    hostKey?: string
    publicKey?: Buffer
    password?: string
    port?: number
    sftpRoot?: string
    scpRoot?: string
    execReply?: (command: string) => { stdout?: string; code?: number; hang?: boolean }
  } = {},
) {
  const hostKey =
    options.hostKey ||
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey
  let authentications = 0,
    passwordAuthentications = 0,
    windowSize = { cols: 80, rows: 24 }
  const clients = new Set<Connection>()
  const execRequests: string[] = []
  const scpModeOverrides = new Map<string, number>()
  const shellWords = (command: string) => {
    const words: string[] = []
    let value = '',
      quote: 'single' | 'double' | undefined,
      escaped = false,
      active = false
    for (const char of command) {
      if (escaped) {
        value += char
        escaped = false
        active = true
        continue
      }
      if (quote === 'single') {
        if (char === "'") quote = undefined
        else value += char
        active = true
        continue
      }
      if (quote === 'double') {
        if (char === '"') quote = undefined
        else value += char
        active = true
        continue
      }
      if (char === '\\') {
        escaped = true
        active = true
        continue
      }
      if (char === "'") {
        quote = 'single'
        active = true
        continue
      }
      if (char === '"') {
        quote = 'double'
        active = true
        continue
      }
      if (/\s/.test(char)) {
        if (active) {
          words.push(value)
          value = ''
          active = false
        }
        continue
      }
      value += char
      active = true
    }
    if (active) words.push(value)
    return words
  }
  const remotePath = (root: string, path: string) => {
    const full = resolve(root, '.' + posix.resolve('/', path)),
      rel = relative(root, full)
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
      throw new Error('denied')
    return full
  }
  const ack = (channel: ServerChannel) => channel.write(Buffer.from([0]))
  const acceptScp = async (channel: ServerChannel, command: string) => {
    if (!options.scpRoot) {
      channel.stderr.write('scp unavailable')
      channel.exit(127)
      channel.end()
      return
    }
    const words = shellWords(command),
      pathIndex = words.findIndex((word) => word === '-t' || word === '-f'),
      target = remotePath(
        options.scpRoot,
        words[pathIndex + 2] === '--' ? words[pathIndex + 3] : words[pathIndex + 2],
      ),
      mode = words[pathIndex]
    channel.on('error', () => {})
    if (mode === '-t') {
      let buffer = Buffer.alloc(0),
        size = -1,
        outputPath = ''
      ack(channel)
      channel.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        void (async () => {
          if (size < 0) {
            const end = buffer.indexOf(10)
            if (end < 0) return
            const header = buffer.subarray(0, end).toString('utf8'),
              match = /^C([0-7]{4}) (\d+) (.*)$/.exec(header)
            if (!match) throw new Error('bad scp header')
            size = Number(match[2])
            buffer = buffer.subarray(end + 1)
            const targetStat = await fs.stat(target).catch(() => undefined)
            outputPath = targetStat?.isDirectory() ? join(target, match[3]) : target
            ack(channel)
          }
          if (size >= 0 && buffer.length >= size + 1) {
            if (buffer[size] !== 0) throw new Error('bad scp terminator')
            await fs.writeFile(outputPath, buffer.subarray(0, size), { mode: 0o644 })
            ack(channel)
            channel.exit(0)
            channel.end()
          }
        })().catch((error) => {
          channel.stderr.write(String(error))
          channel.exit(1)
          channel.end()
        })
      })
      return
    }
    const data = await fs.readFile(target),
      stat = await fs.stat(target)
    let buffer = Buffer.alloc(0)
    channel.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length && buffer[0] === 0) {
        channel.removeAllListeners('data')
        channel.write(
          `C${(stat.mode & 0o777).toString(8).padStart(4, '0')} ${data.length} ${basename(target)}\n`,
        )
        let received = Buffer.alloc(0)
        const receiveAck = (part: Buffer) => {
          received = Buffer.concat([received, part])
          if (!received.length) return
          channel.removeAllListeners('data')
          if (received[0] !== 0) {
            channel.exit(1)
            channel.end()
            return
          }
          channel.write(data)
          channel.write(Buffer.from([0]))
          channel.once('data', (finalAck: Buffer) => {
            channel.exit(finalAck[0] === 0 ? 0 : 1)
            channel.end()
          })
        }
        channel.once('data', receiveAck)
      }
    })
  }
  const serveScpCommand = async (channel: ServerChannel, command: string) => {
    try {
      const words = shellWords(command),
        findIndex = words.indexOf('find')
      if (command.startsWith('scp ')) return void acceptScp(channel, command)
      if (!options.scpRoot) throw new Error('scp root unavailable')
      const principal = words[0] === 'getent' && ['passwd', 'group'].includes(words[1])
      if (principal && /^\d+$/.test(words[2])) {
        const label = words[1] === 'passwd' ? `user${words[2]}` : `group${words[2]}`
        channel.write(`${label}:x:${words[2]}:${words[2]}::/home/${label}:/bin/sh\n`)
        channel.exit(0)
        channel.end()
        return
      }
      if (principal && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(words[2])) {
        const id = words[1] === 'passwd' ? '1201' : '1302'
        channel.write(`${words[2]}:x:${id}:${id}::/home/${words[2]}:/bin/sh\n`)
        channel.exit(0)
        channel.end()
        return
      }
      if (findIndex >= 0) {
        const path = remotePath(options.scpRoot, words[findIndex + 1]),
          stat = await fs.lstat(path).catch((error) => {
            if (words[0] === 'if' && (error as NodeJS.ErrnoException).code === 'ENOENT')
              return undefined
            throw error
          })
        if (!stat) {
          channel.exit(0)
          channel.end()
          return
        }
        if (words.includes('-mindepth')) {
          const names = await fs.readdir(path),
            rows = await Promise.all(
              names.map(async (name) => {
                const entry = await fs.lstat(join(path, name)),
                  childPath = join(path, name),
                  type = entry.isSymbolicLink() ? 'l' : entry.isDirectory() ? 'd' : 'f'
                return `${name}\0${type}\0${entry.size}\0${entry.mtimeMs / 1000}\0${(scpModeOverrides.get(childPath) ?? entry.mode & 0o7777).toString(8)}\0${entry.uid}\0${entry.gid}\0`
              }),
            )
          channel.write(rows.join(''))
        } else
          channel.write(
            `${stat.isSymbolicLink() ? 'l' : stat.isDirectory() ? 'd' : 'f'}\0${stat.size}\0${stat.mtimeMs / 1000}\0${(scpModeOverrides.get(path) ?? stat.mode & 0o7777).toString(8)}\0`,
          )
      } else if (words[0] === 'readlink') channel.write(posix.normalize(words.at(-1)!) + '\n')
      else if (words[0] === 'mkdir') await fs.mkdir(remotePath(options.scpRoot, words.at(-1)!))
      else if (words[0] === 'chmod') {
        const path = remotePath(options.scpRoot, words.at(-1)!),
          mode = Number.parseInt(words[1], 8)
        scpModeOverrides.set(path, mode)
        await fs.chmod(path, mode).catch(() => {})
      } else if (words[0] === 'chown') {
        if (!/^\d+:\d+$/.test(words[1])) throw new Error('invalid chown ids')
        remotePath(options.scpRoot, words.at(-1)!)
      } else if (words[0] === 'mv')
        await fs.rename(
          remotePath(options.scpRoot, words.at(-2)!),
          remotePath(options.scpRoot, words.at(-1)!),
        )
      else if (words[0] === 'rm') await fs.unlink(remotePath(options.scpRoot, words.at(-1)!))
      else if (words[0] === 'rmdir') await fs.rmdir(remotePath(options.scpRoot, words.at(-1)!))
      else throw new Error('unsupported fixture command')
      channel.exit(0)
      channel.end()
    } catch (error) {
      channel.stderr.write(String(error))
      channel.exit(1)
      channel.end()
    }
  }
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', (context) => {
      authentications++
      if (context.method === 'password') passwordAuthentications++
      if (
        context.method === 'password' &&
        context.password === (options.password || 'test-password')
      )
        context.accept()
      else if (
        context.method === 'publickey' &&
        options.publicKey &&
        context.key.data.equals(options.publicKey)
      )
        context.accept()
      else context.reject(['password', 'publickey'])
    })
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        session.on('exec', (accept, reject, info) => {
          execRequests.push(info.command)
          if (options.scpRoot) {
            void serveScpCommand(accept(), info.command)
            return
          }
          if (!options.execReply) {
            reject()
            return
          }
          const channel = accept(),
            reply = options.execReply(info.command)
          channel.on('error', () => {})
          if (!reply.hang) {
            channel.write(reply.stdout || '')
            channel.exit(reply.code || 0)
            channel.end()
          }
        })
        session.on('sftp', (accept, reject) => {
          if (options.sftpRoot) serveSftp(accept(), options.sftpRoot)
          else reject()
        })
        session.on('pty', (accept, _reject, info) => {
          windowSize = { cols: info.cols, rows: info.rows }
          accept?.()
        })
        session.on('window-change', (accept, _reject, info) => {
          windowSize = { cols: info.cols, rows: info.rows }
          accept?.()
        })
        session.on('shell', (accept) => {
          const channel = accept()
          channel.write(options.shellGreeting || 'READY\r\n')
          channel.on('data', (data) => channel.write(Buffer.concat([Buffer.from('ECHO:'), data])))
          channel.on('error', () => {})
        })
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(options.port || 0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    server,
    hostKey,
    port,
    execRequests,
    get clientCount() {
      return clients.size
    },
    get authentications() {
      return authentications
    },
    get passwordAuthentications() {
      return passwordAuthentications
    },
    get windowSize() {
      return windowSize
    },
    async close() {
      clients.forEach((client) => client.end())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
