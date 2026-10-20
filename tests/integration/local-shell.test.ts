import { expect, it } from 'vitest'
import { SessionManager } from '../../src/main/sessions/SessionManager'
import { LocalShellAdapter } from '../../src/main/sessions/LocalShellAdapter'
import type { LocalShellProfile, SessionEvent } from '../../src/shared/contracts'

it('runs PowerShell through the owned session lifecycle and closes after logout', async ({
  skip,
}) => {
  if (process.platform !== 'win32') skip()
  const inheritedModulePath = process.env.PSModulePath
  delete process.env.PSModulePath
  const events: SessionEvent[] = [],
    output: string[] = []
  let manager: SessionManager,
    sessionId = ''
  manager = new SessionManager(
    (profile) => new LocalShellAdapter((profile as LocalShellProfile).shell),
    (owner, event) => {
      events.push(event)
      if (event.type === 'data') {
        output.push(Buffer.from(event.data).toString('utf8'))
        queueMicrotask(() => manager.ack(owner, event.sessionId, event.sequence))
      }
    },
  )
  sessionId = await manager.open(1, {
    protocol: 'local',
    name: 'PowerShell',
    shell: 'powershell',
  })
  const waitFor = async (predicate: () => boolean) => {
    const started = Date.now()
    while (!predicate() && Date.now() - started < 8000)
      await new Promise((resolve) => setTimeout(resolve, 25))
    expect(
      predicate(),
      JSON.stringify({
        events: events.map((event) => (event.type === 'state' ? event.state : event.type)),
        output: output.join(''),
      }),
    ).toBe(true)
  }
  try {
    await waitFor(() =>
      events.some((event) => event.type === 'state' && event.state === 'connected'),
    )
    manager.write(1, sessionId, "Write-Output 'LOCAL_INTEGRATION_OK'\r")
    await waitFor(() => output.join('').includes('LOCAL_INTEGRATION_OK'))
    manager.write(1, sessionId, 'exit\r')
    await waitFor(() =>
      events.some((event) => event.type === 'closed' && event.sessionId === sessionId),
    )
    expect(manager.count(1)).toBe(0)
  } finally {
    await manager.closeOwner(1)
    if (inheritedModulePath !== undefined) process.env.PSModulePath = inheritedModulePath
  }
})
