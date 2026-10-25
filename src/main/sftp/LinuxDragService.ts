import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '../../shared/errors'
import { LazyDragTree } from './LazyDragTree'

type Export = {
  child: ChildProcessWithoutNullStreams
  tree: LazyDragTree
  mount: string
  lastUse: number
  sessionId: string
  closing?: Promise<void>
}
/** Each mount exports one selection. Only a kernel read request starts content retrieval. */
export class LinuxDragService {
  private exports = new Set<Export>()
  private closed = false
  private timer: NodeJS.Timeout
  constructor(
    private helper: string,
    private root: string,
  ) {
    this.timer = setInterval(() => {
      for (const entry of this.exports)
        if (Date.now() - entry.lastUse > 5 * 60_000) void this.remove(entry)
    }, 30_000)
    this.timer.unref()
  }
  available() {
    return (
      process.platform === 'linux' &&
      existsSync(this.helper) &&
      existsSync('/dev/fuse') &&
      existsSync('/usr/bin/fusermount3')
    )
  }
  owns(sessionId: string, path: string) {
    return (
      !this.closed &&
      [...this.exports].some(
        (entry) =>
          entry.sessionId === sessionId &&
          !entry.closing &&
          join(entry.mount, entry.tree.name) === path,
      )
    )
  }
  async prepare(sessionId: string, tree: LazyDragTree) {
    if (this.closed || !this.available())
      throw new AppError('drag-unavailable', 'Для переноса нужен FUSE3 (пакет fuse3)')
    if (this.exports.size >= 32)
      throw new AppError('drag-busy', 'Дождитесь завершения текущих переносов')
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    const rootStat = await fs.lstat(this.root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid?.())
      throw new AppError('unsafe-cache', 'Временная папка переноса недоступна')
    const mount = await fs.mkdtemp(join(this.root, 'export-'))
    const child = spawn(
      this.helper,
      [
        mount,
        tree.name,
        tree.initial.directory ? 'd' : 'f',
        String(tree.initial.size),
        String(tree.initial.modifiedAt),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    const entry: Export = { child, tree, mount, lastUse: Date.now(), sessionId }
    this.exports.add(entry)
    let readyResolve: () => void, readyReject: (e: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    let errors = ''
    child.stderr.on('data', (b) => {
      errors = (errors + String(b)).slice(-2048)
    })
    child.stdin.on('error', () => {})
    child.once('error', (e) => readyReject(e))
    child.once('exit', () => {
      readyReject(
        new AppError('drag-mount', 'Не удалось подключить файловый мост FUSE3: ' + errors),
      )
      void this.remove(entry)
    })
    const lines = createInterface({ input: child.stdout })
    let queue = Promise.resolve()
    lines.on('line', (line) => {
      if (line === 'READY') {
        readyResolve()
        return
      }
      entry.lastUse = Date.now()
      queue = queue
        .then(() => this.respond(entry, line))
        .catch(() => {
          child.kill()
        })
    })
    const timeout = setTimeout(
      () => readyReject(new AppError('drag-timeout', 'Файловый мост не ответил')),
      5000,
    )
    try {
      await ready
      if (this.closed) throw new AppError('closing', 'Приложение завершает работу')
      return join(mount, tree.name)
    } catch (error) {
      await this.remove(entry)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  private async respond(entry: Export, line: string) {
    const fields = line.split('\t')
    let status = 0
    let body: Buffer = Buffer.alloc(0)
    try {
      if (fields.length !== 4 || fields[3].length > 8192 || !/^(?:[a-f0-9]{2})+$/.test(fields[3]))
        throw Error('Invalid request')
      const path = Buffer.from(fields[3], 'hex').toString('utf8'),
        offset = Number(fields[1]),
        length = Number(fields[2])
      if (fields[0] === 'R') body = await entry.tree.read(path, offset, length)
      else if (fields[0] === 'S') {
        const stat = await entry.tree.stat(path)
        body = Buffer.alloc(17)
        body[0] = stat.directory ? 100 : 102
        body.writeBigUInt64LE(BigInt(stat.size), 1)
        body.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(stat.modifiedAt))), 9)
      } else if (fields[0] === 'D')
        body = Buffer.from(
          (await entry.tree.list(path)).map((name) => Buffer.from(name).toString('hex')).join('\n'),
        )
      else throw Error('Invalid operation')
      if (body.length > 16 * 1024 * 1024) throw Error('Response too large')
    } catch (error) {
      const code = (error as AppError).code
      status = ['file-missing', 'unsafe-path'].includes(code)
        ? -2
        : code === 'not-directory'
          ? -20
          : -5
      body = Buffer.alloc(0)
    }
    const header = Buffer.alloc(8)
    header.writeInt32LE(status)
    header.writeUInt32LE(body.length, 4)
    if (!entry.child.stdin.destroyed) entry.child.stdin.write(Buffer.concat([header, body]))
  }
  private remove(entry: Export): Promise<void> {
    if (entry.closing) return entry.closing
    entry.closing = (async () => {
      await promisify(execFile)('/usr/bin/fusermount3', ['-uz', entry.mount], {
        timeout: 3000,
      }).catch(() => {})
      entry.child.kill('SIGTERM')
      await entry.tree.close().catch(() => {})
      /* Never recursively delete a mountpoint. */ await fs.rmdir(entry.mount).catch(() => {})
      this.exports.delete(entry)
    })()
    return entry.closing
  }
  async closeSession(id: string) {
    await Promise.all(
      [...this.exports].filter((e) => e.sessionId === id).map((e) => this.remove(e)),
    )
  }
  async close() {
    this.closed = true
    clearInterval(this.timer)
    await Promise.all([...this.exports].map((e) => this.remove(e)))
  }
}
