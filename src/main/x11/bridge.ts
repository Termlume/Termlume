import { connect, type Socket } from 'node:net'
import type { Client, ClientChannel } from 'ssh2'
import { rewriteX11Setup } from './auth'

export interface X11Endpoint {
  port: number
  cookie: Buffer
}

/** ssh2 channels use stream backpressure; unauthenticated setup is capped at 64 KiB. */
export function attachX11Bridge(
  client: Client,
  remoteCookie: Buffer,
  endpoint: X11Endpoint,
  notice: (message: string) => void,
) {
  const channels = new Set<() => void>()
  const listener = (_info: unknown, accept: () => ClientChannel, reject: () => void) => {
    if (channels.size >= 32) {
      reject()
      return
    }
    const channel = accept()
    let socket: Socket | undefined,
      pending = Buffer.alloc(0),
      finished = false
    const timer = setTimeout(
      () => fail('X11: приложение не прислало корректный запрос за 10 секунд.'),
      10000,
    )
    const cleanup = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      channels.delete(cleanup)
      channel.destroy()
      socket?.destroy()
    }
    const fail = (message: string) => {
      notice(message)
      cleanup()
    }
    channels.add(cleanup)
    channel.on('error', cleanup)
    channel.on('close', cleanup)
    const setup = (chunk: Buffer) => {
      if (pending.length + chunk.length > 65536)
        return fail('X11: превышен размер запроса авторизации.')
      pending = Buffer.concat([pending, chunk])
      try {
        const rewritten = rewriteX11Setup(pending, remoteCookie, endpoint.cookie)
        if (!rewritten) return
        channel.pause()
        channel.removeListener('data', setup)
        clearTimeout(timer)
        socket = connect({ host: '127.0.0.1', port: endpoint.port })
        socket.setTimeout(10000, () => fail('X11: локальный X-сервер не ответил.'))
        socket.once('connect', () => {
          socket!.setTimeout(0)
          socket!.write(rewritten, () => {
            if (finished) return
            pending = Buffer.alloc(0)
            channel.pipe(socket!)
            socket!.pipe(channel)
            channel.resume()
          })
        })
        socket.on('error', () => fail('X11: соединение с локальным X-сервером потеряно.'))
        socket.on('close', cleanup)
      } catch {
        fail('X11: отклонён неверный cookie авторизации приложения.')
      }
    }
    channel.on('data', setup)
  }
  client.on('x11', listener)
  return () => {
    client.removeListener('x11', listener)
    for (const close of [...channels]) close()
    remoteCookie.fill(0)
  }
}
