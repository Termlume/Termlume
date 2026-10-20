import { createServer, type Socket } from 'node:net'
export async function telnetFixture() {
  const sockets = new Set<Socket>(),
    received: Buffer[] = []
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', (data) => received.push(data))
    const bytes = Buffer.concat([
      Buffer.from([255, 253, 31, 255, 251, 1]),
      Buffer.from('ПРИВЕТ\r\n', 'utf8'),
    ])
    let offset = 0
    const timer = setInterval(() => {
      if (offset < bytes.length && !socket.destroyed) socket.write(bytes.subarray(offset, ++offset))
      else clearInterval(timer)
    }, 2)
    socket.on('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as { port: number }).port,
    received,
    async close() {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
