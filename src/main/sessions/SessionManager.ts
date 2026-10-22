import { randomUUID } from 'node:crypto'
import type { AdapterEvent, SessionProfile, SessionEvent } from '../../shared/contracts'
import type { SessionAdapter } from './SessionAdapter'
import { AppError, safeError } from '../../shared/errors'
import { OutputBuffer } from './OutputBuffer'
import { TerminalCwdTracker } from './TerminalCwdTracker'
interface Entry {
  ownerId: number
  profile: SessionProfile
  adapter: SessionAdapter
  abort: AbortController
  sequence: number
  closed: boolean
  connected: boolean
  ending?: boolean
  off: () => void
  output: OutputBuffer
  cwd?: TerminalCwdTracker
  closing?: Promise<void>
}
export class SessionManager {
  private entries = new Map<string, Entry>()
  constructor(
    private factory: (
      profile: SessionProfile,
      id: string,
      ownerId: number,
    ) => SessionAdapter | Promise<SessionAdapter>,
    private sink: (ownerId: number, event: SessionEvent) => void,
  ) {}
  async open(ownerId: number, profile: SessionProfile): Promise<string> {
    const id = randomUUID(),
      adapter = await this.factory(profile, id, ownerId)
    const entry: Entry = {
      ownerId,
      profile,
      adapter,
      abort: new AbortController(),
      sequence: 0,
      closed: false,
      connected: false,
      off: () => {},
      output: null!,
    }
    const emit = (event: AdapterEvent) => {
      const sequence = ++entry.sequence
      if (!entry.closed) this.sink(ownerId, { ...event, sessionId: id, sequence })
      return sequence
    }
    entry.output = new OutputBuffer(
      (data) => emit({ type: 'data', data }),
      () => adapter.pauseOutput(),
      () => adapter.resumeOutput(),
    )
    if (profile.protocol === 'ssh' || profile.protocol === 'wsl' || profile.protocol === 'local')
      entry.cwd = new TerminalCwdTracker(
        profile.protocol === 'ssh' && adapter.cwdUsername
          ? { ...profile, username: adapter.cwdUsername }
          : profile,
        (path) => {
          if (!entry.closed && !entry.ending) emit({ type: 'cwd', path })
        },
      )
    entry.off = adapter.subscribe((event) => {
      if (entry.closed || entry.ending) return
      if (event.type === 'data') {
        entry.output.push(event.data)
        entry.cwd?.feed(event.data)
      } else if (event.type === 'closed') {
        entry.ending = true
        entry.cwd?.close()
        entry.connected = false
        if (event.reason !== 'remote-exit') emit({ type: 'state', state: 'disconnected' })
        void entry.output.finish().then(() => {
          if (event.reason === 'remote-exit') emit({ type: 'closed', reason: 'remote-exit' })
          void this.dispose(id, false)
        })
      } else emit(event)
    })
    this.entries.set(id, entry)
    emit({ type: 'state', state: 'connecting' })
    queueMicrotask(() =>
      adapter
        .connect(entry.abort.signal)
        .then(() => {
          if (!entry.closed && !entry.ending) {
            entry.connected = true
            emit({ type: 'state', state: 'connected' })
          }
        })
        .catch((error) => {
          if (!entry.closed) {
            emit({ type: 'error', error: safeError(error) })
            emit({ type: 'state', state: 'error' })
            void this.dispose(id, false)
          }
        }),
    )
    return id
  }
  private owned(ownerId: number, id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry || entry.ownerId !== ownerId) throw new AppError('forbidden', 'forbidden')
    return entry
  }
  get(ownerId: number, id: string) {
    return this.owned(ownerId, id)
  }
  private terminal(entry: Entry) {
    if (entry.profile.protocol === 'sftp' || entry.profile.protocol === 'ftp')
      throw new AppError('terminal-unsupported', 'Файловый сеанс не имеет терминала')
    return entry
  }
  write(ownerId: number, id: string, data: string) {
    const entry = this.terminal(this.owned(ownerId, id))
    if (!entry.connected) throw new AppError('not-connected', 'Сеанс не подключён')
    entry.cwd?.input(data)
    entry.adapter.write(data)
  }
  resize(ownerId: number, id: string, cols: number, rows: number) {
    this.terminal(this.owned(ownerId, id)).adapter.resize(cols, rows)
  }
  ack(ownerId: number, id: string, sequence: number) {
    this.terminal(this.owned(ownerId, id)).output.ack(sequence)
  }
  count(ownerId: number) {
    return [...this.entries.values()].filter((entry) => entry.ownerId === ownerId).length
  }
  list(ownerId: number) {
    return [...this.entries]
      .filter(([, entry]) => entry.ownerId === ownerId)
      .map(([id, entry]) => ({ id, connected: entry.connected, ending: entry.ending || false }))
  }
  async close(ownerId: number, id: string) {
    if (!this.entries.has(id)) return
    this.owned(ownerId, id)
    await this.dispose(id, true)
  }
  private async dispose(id: string, notify: boolean) {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.closing) return entry.closing
    if (notify)
      this.sink(entry.ownerId, { type: 'closed', sessionId: id, sequence: ++entry.sequence })
    entry.closed = true
    entry.cwd?.close()
    entry.abort.abort()
    entry.off()
    entry.output.dispose()
    entry.closing = entry.adapter
      .close()
      .catch(() => {})
      .finally(() => this.entries.delete(id))
    return entry.closing
  }
  async closeOwner(ownerId: number) {
    await Promise.all(
      [...this.entries]
        .filter(([, entry]) => entry.ownerId === ownerId)
        .map(([id]) => this.dispose(id, true)),
    )
  }
}
