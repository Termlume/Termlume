import { createServer, type Socket, type Server } from 'node:net'
import * as fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { posix, resolve, relative, isAbsolute } from 'node:path'

/** Small passive FTP fixture; deliberately no shell or external daemon dependency. */
export async function ftpFixture(root: string) {
  const sockets = new Set<Socket>(),
    passive = new Set<Server>(),
    commands: string[] = []
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let cwd = '/',
      buffer = '',
      renameFrom = '',
      data: Promise<Socket> | undefined
    let authenticated = false
    const reply = (line: string) => socket.write(line + '\r\n')
    const full = (path: string) => {
      const target = resolve(root, '.' + posix.resolve(cwd, path)),
        rel = relative(root, target)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('outside root')
      return target
    }
    let tail: Promise<unknown> = Promise.resolve()
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'),
          line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        tail = tail
          .then(async () => {
            const space = line.indexOf(' '),
              command = (space < 0 ? line : line.slice(0, space)).toUpperCase(),
              arg = space < 0 ? '' : line.slice(space + 1)
            commands.push(command)
            if (command === 'USER') return reply('331 password required')
            if (command === 'PASS') {
              authenticated = arg === 'test-password'
              return reply(authenticated ? '230 logged in' : '530 incorrect password')
            }
            if (command === 'QUIT') {
              reply('221 bye')
              socket.end()
              return
            }
            if (command === 'AUTH') return reply('502 TLS unavailable')
            if (!authenticated) return reply('530 log in first')
            if (command === 'FEAT')
              return reply('211-Features\r\n MLST type*;size*;modify*;\r\n211 End')
            if (['TYPE', 'STRU', 'OPTS'].includes(command)) return reply('200 OK')
            if (command === 'PWD') return reply('257 "' + cwd + '"')
            if (command === 'CDUP') {
              cwd = posix.dirname(cwd)
              return reply('250 parent')
            }
            if (command === 'CWD') {
              if (!(await fs.stat(full(arg))).isDirectory()) throw new Error('not dir')
              cwd = posix.resolve(cwd, arg)
              return reply('250 changed')
            }
            if (command === 'MKD') {
              await fs.mkdir(full(arg))
              return reply('257 created')
            }
            if (command === 'RMD') {
              await fs.rmdir(full(arg))
              return reply('250 removed')
            }
            if (command === 'DELE') {
              await fs.unlink(full(arg))
              return reply('250 deleted')
            }
            if (command === 'RNFR') {
              renameFrom = full(arg)
              return reply('350 rename ready')
            }
            if (command === 'RNTO') {
              await fs.rename(renameFrom, full(arg))
              return reply('250 renamed')
            }
            if (command === 'EPSV') {
              const listener = createServer()
              passive.add(listener)
              data = new Promise((accept) =>
                listener.once('connection', (stream) => {
                  sockets.add(stream)
                  stream.on('error', () => {})
                  stream.on('close', () => sockets.delete(stream))
                  accept(stream)
                  listener.close()
                  passive.delete(listener)
                }),
              )
              await new Promise<void>((ready) => listener.listen(0, '127.0.0.1', ready))
              return reply(
                '229 Entering Extended Passive Mode (|||' +
                  (listener.address() as { port: number }).port +
                  '|)',
              )
            }
            if (['MLSD', 'LIST', 'STOR', 'RETR'].includes(command)) {
              if (!data) throw new Error('passive required')
              reply('150 opening data')
              const stream = await data
              data = undefined
              if (command === 'MLSD' || command === 'LIST') {
                const path = full(arg || '.'),
                  names = await fs.readdir(path)
                const lines = await Promise.all(
                  names.map(async (name) => {
                    const stat = await fs.lstat(resolve(path, name))
                    return (
                      'type=' +
                      (stat.isDirectory() ? 'dir' : 'file') +
                      ';size=' +
                      stat.size +
                      ';modify=' +
                      stat.mtime.toISOString().replace(/[-:T]/g, '').slice(0, 14) +
                      '; ' +
                      name +
                      '\r\n'
                    )
                  }),
                )
                stream.end(lines.join(''))
              } else if (command === 'RETR') stream.end(await fs.readFile(full(arg)))
              else {
                await pipeline(stream, createWriteStream(full(arg)))
                stream.end()
              }
              reply('226 complete')
              return
            }
            reply('502 unsupported')
          })
          .catch(() => reply('550 unavailable'))
      }
    })
    reply('220 fixture ready')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return {
    port: (server.address() as { port: number }).port,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy()
      for (const listener of passive) listener.close()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
