import { EventEmitter } from 'node:events'
import type { Client, ClientChannel } from 'ssh2'
import { expect, it, vi } from 'vitest'
import { ScpService } from '../../src/main/sftp/ScpService'

it('rejects an SCP operation if it is aborted while the SSH channel is opening', async () => {
  let callback: ((error: Error | undefined, channel?: ClientChannel) => void) | undefined
  let notifyExecStarted!: () => void
  const execStarted = new Promise<void>((resolve) => (notifyExecStarted = resolve)),
    channel = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      write: vi.fn(() => true),
      close: vi.fn(function (this: EventEmitter) {
        this.emit('close')
      }),
    }) as unknown as ClientChannel,
    client = {
      exec: vi.fn((_command: string, _options: unknown, done: typeof callback) => {
        callback = done
        notifyExecStarted()
      }),
    } as unknown as Client,
    controller = new AbortController(),
    service = new ScpService(() => client),
    operation = (service as unknown as {
      open(id: string, command: string, signal: AbortSignal): Promise<ClientChannel>
    }).open('session', 'scp -f -- source.txt', controller.signal)
  await execStarted
  controller.abort()
  callback?.(undefined, channel)
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  expect(channel.close).toHaveBeenCalledOnce()
})
