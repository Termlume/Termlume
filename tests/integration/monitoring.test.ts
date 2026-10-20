import { it, expect } from 'vitest'
import { Client } from 'ssh2'
import { sshFixture } from './fixtures/ssh-server'
import { execText } from '../../src/main/monitoring/exec-text'
import { LinuxMonitor } from '../../src/main/monitoring/LinuxMonitor'
async function connect(port: number) {
  const client = new Client()
  await new Promise<void>((resolve, reject) =>
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port,
        username: 'user',
        password: 'test-password',
        hostVerifier: () => true,
      }),
  )
  return client
}
async function shellWorks(client: Client) {
  return new Promise<boolean>((resolve) =>
    client.shell((error, channel) => {
      channel?.close()
      resolve(!error)
    }),
  )
}
it('deniedExecDoesNotCloseShell', async () => {
  const server = await sshFixture(),
    client = await connect(server.port)
  try {
    await expect(execText(client, 'uname -s', new AbortController().signal)).rejects.toThrow()
    expect(await shellWorks(client)).toBe(true)
  } finally {
    client.end()
    await server.close()
  }
})
it('nonLinuxStopsMonitoringWithoutClosingShell', async () => {
  const server = await sshFixture({ execReply: () => ({ stdout: 'RouterOS\n' }) }),
    client = await connect(server.port),
    monitor = new LinuxMonitor((command, signal) => execText(client, command, signal))
  try {
    const snapshot = new Promise<string>((resolve) =>
      monitor.subscribe((value) => resolve(value.state)),
    )
    monitor.start()
    expect(await snapshot).toBe('unsupported')
    expect(server.execRequests).toEqual(['uname -s'])
    expect(await shellWorks(client)).toBe(true)
  } finally {
    monitor.close()
    client.end()
    await server.close()
  }
})
it('hungChannelTimesOutAtFiveSecondsAndCanBeCanceled', async () => {
  const server = await sshFixture({ execReply: () => ({ hang: true }) }),
    client = await connect(server.port)
  try {
    const started = Date.now()
    await expect(execText(client, 'hang', new AbortController().signal)).rejects.toMatchObject({
      code: 'monitor-timeout',
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900)
    const controller = new AbortController(),
      pending = execText(client, 'hang', controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'canceled' })
    controller.abort()
    await assertion
    expect(await shellWorks(client)).toBe(true)
  } finally {
    client.end()
    await server.close()
  }
}, 10000)
