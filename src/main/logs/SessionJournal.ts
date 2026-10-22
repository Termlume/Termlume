import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { SessionLogConfig, SessionLogEntry } from '../../shared/session-logs'

// Stateful stripping matters: escape sequences frequently span output chunks.
export class PlainOutput {
  private escape = ''
  push(data: string) {
    let result = ''
    for (const c of data) {
      if (this.escape) {
        this.escape += c
        if (this.escape === '\x1b[' || this.escape === '\x1b]' || this.escape === '\x1bP') continue
        const kind = this.escape[1]
        if (
          (kind === '[' && /[@-~]/.test(c)) ||
          ((kind === ']' || kind === 'P') && (c === '\x07' || this.escape.endsWith('\x1b\\'))) ||
          (kind !== '[' && kind !== ']' && kind !== 'P')
        )
          this.escape = ''
        if (this.escape.length > 65536) this.escape = ''
      } else if (c === '\x1b') this.escape = c
      else if (c === '\n' || c === '\t' || c === '\r' || c >= ' ') result += c
    }
    return result
  }
}
type RecordEntry = SessionLogEntry & { folder: string }
export class SessionJournal {
  private config: SessionLogConfig
  private entries: RecordEntry[] = []
  private active = new Map<
    string,
    { entry: RecordEntry; plain: PlainOutput; decoder: StringDecoder }
  >()
  private queue: Promise<void> = Promise.resolve()
  private pendingBytes = 0
  private ready: Promise<void>
  constructor(
    private root: string,
    private notice: (message: string) => void,
  ) {
    this.config = {
      folder: join(root, 'session-logs'),
      auto: false,
      hostIds: [],
      retentionDays: 30,
      maxSizeMb: 100,
    }
    this.ready = this.load()
  }
  private async load() {
    try {
      this.config = {
        ...this.config,
        ...JSON.parse(await fs.readFile(join(this.root, 'journal-config.json'), 'utf8')),
      }
    } catch {}
    try {
      this.entries = JSON.parse(
        await fs.readFile(join(this.root, 'journal-index.json'), 'utf8'),
      ).map((e: RecordEntry) => ({ ...e, active: false }))
    } catch {}
    try {
      await this.rotate()
    } catch {
      this.notice('Не удалось очистить старые журналы сеансов.')
    }
  }
  private enqueue(task: () => Promise<void>) {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {
      this.notice('Не удалось записать журнал сеанса. Проверьте папку и свободное место.')
    })
    return result
  }
  private async save() {
    await fs.mkdir(this.root, { recursive: true })
    await fs.writeFile(join(this.root, 'journal-index.json'), JSON.stringify(this.entries), 'utf8')
  }
  private path(entry: RecordEntry) {
    return join(entry.folder, `termlume-${entry.id}.txt`)
  }
  async settings() {
    await this.ready
    return { ...this.config }
  }
  async configure(patch: Partial<SessionLogConfig>) {
    await this.ready
    return this.enqueue(async () => {
      this.config = { ...this.config, ...patch }
      await fs.mkdir(this.config.folder, { recursive: true })
      await fs.writeFile(
        join(this.root, 'journal-config.json'),
        JSON.stringify(this.config),
        'utf8',
      )
      await this.rotate()
      return undefined
    }).then(() => this.settings())
  }
  async autoStart(sessionId: string, hostId: string, label: string) {
    await this.ready
    if (this.config.auto || this.config.hostIds.includes(hostId)) await this.start(sessionId, label)
  }
  async start(sessionId: string, label: string) {
    await this.ready
    await this.enqueue(async () => {
      if (this.active.has(sessionId)) return
      const entry: RecordEntry = {
        id: randomUUID(),
        sessionId,
        label,
        startedAt: Date.now(),
        bookmarked: false,
        bytes: 0,
        active: true,
        folder: this.config.folder,
      }
      await fs.mkdir(entry.folder, { recursive: true })
      await fs.writeFile(this.path(entry), '', { encoding: 'utf8', flag: 'wx' })
      this.entries.push(entry)
      this.active.set(sessionId, {
        entry,
        plain: new PlainOutput(),
        decoder: new StringDecoder('utf8'),
      })
      await this.save()
    })
  }
  output(sessionId: string, data: string | Uint8Array) {
    const recording = this.active.get(sessionId)
    if (!recording) return
    const plain = recording.plain.push(
        typeof data === 'string' ? data : recording.decoder.write(Buffer.from(data)),
      ),
      bytes = Buffer.byteLength(plain)
    if (!bytes) return
    if (
      this.pendingBytes + bytes > 2 * 1024 * 1024 ||
      recording.entry.bytes + bytes > this.config.maxSizeMb * 1024 * 1024
    ) {
      this.notice(
        'Запись журнала остановлена: достигнут лимит размера или очередь записи заполнена.',
      )
      void this.stop(sessionId).catch(() => {})
      return
    }
    recording.entry.bytes += bytes
    this.pendingBytes += bytes
    void this.enqueue(async () => {
      try {
        await fs.appendFile(this.path(recording.entry), plain, 'utf8')
      } catch (error) {
        this.active.delete(sessionId)
        recording.entry.active = false
        throw error
      } finally {
        this.pendingBytes -= bytes
      }
    }).catch(() => {})
  }
  async stop(sessionId: string) {
    await this.ready
    const recording = this.active.get(sessionId)
    if (recording) {
      const tail = recording.decoder.end()
      if (tail) this.output(sessionId, tail)
    }
    this.active.delete(sessionId)
    if (recording) recording.entry.active = false
    await this.enqueue(async () => {
      await this.save()
      await this.rotate()
    })
  }
  async list() {
    await this.ready
    await this.queue
    return this.entries.map(({ folder: _folder, ...entry }) => ({ ...entry })).reverse()
  }
  private find(id: string) {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) throw new Error('Журнал не найден')
    return entry
  }
  async read(id: string) {
    await this.ready
    await this.queue
    const file = await fs.open(this.path(this.find(id)), 'r')
    try {
      const buffer = Buffer.alloc(2 * 1024 * 1024)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const decoder = new StringDecoder('utf8')
      const content = decoder.write(buffer.subarray(0, bytesRead))
      return (
        content +
        (bytesRead === buffer.length
          ? '\n[Предпросмотр ограничен 2 МБ. Экспорт содержит полный журнал.]'
          : decoder.end())
      )
    } finally {
      await file.close()
    }
  }
  async exportTo(id: string, target: string) {
    await this.ready
    await this.queue
    await fs.copyFile(this.path(this.find(id)), target)
  }
  async bookmark(id: string, bookmarked: boolean) {
    await this.ready
    await this.enqueue(async () => {
      this.find(id).bookmarked = bookmarked
      await this.save()
    })
  }
  private async rotate() {
    let total = this.entries.reduce((sum, e) => sum + e.bytes, 0)
    const cutoff = Date.now() - this.config.retentionDays * 86400000
    for (const entry of [...this.entries].sort((a, b) => a.startedAt - b.startedAt)) {
      if (
        entry.active ||
        entry.bookmarked ||
        (entry.startedAt >= cutoff && total <= this.config.maxSizeMb * 1024 * 1024)
      )
        continue
      // Only paths generated by this journal and present in its private index are removed.
      await fs.unlink(this.path(entry)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
      total -= entry.bytes
      this.entries = this.entries.filter((e) => e !== entry)
    }
    await this.save()
  }
  async close() {
    await this.ready
    for (const id of [...this.active.keys()]) await this.stop(id)
    await this.queue
  }
}
