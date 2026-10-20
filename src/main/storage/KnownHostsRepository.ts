import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AtomicJsonStore } from './AtomicJsonStore'
export function fingerprint(key: Buffer) {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}
export class KnownHostsRepository {
  private store: AtomicJsonStore<Record<string, string>>
  constructor(file: string) {
    this.store = new AtomicJsonStore(file, z.record(z.string(), z.string()), {})
  }
  entries() {
    return this.store.read()
  }
  get path() {
    return this.store.path
  }
  serialize(value: Record<string, string>) {
    return this.store.serialize(value)
  }
  flush() {
    return this.store.flush()
  }
  private identity(host: string, port: number) {
    return JSON.stringify([host.toLowerCase().replace(/^\[|\]$/g, ''), port])
  }
  async check(host: string, port: number, key: Buffer): Promise<'new' | 'match' | 'changed'> {
    const saved = (await this.store.read())[this.identity(host, port)]
    return !saved ? 'new' : saved === fingerprint(key) ? 'match' : 'changed'
  }
  async trust(host: string, port: number, key: Buffer) {
    await this.store.update((data) => ({ ...data, [this.identity(host, port)]: fingerprint(key) }))
  }
}
