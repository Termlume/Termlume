import { z } from 'zod'
import { AtomicJsonStore } from './AtomicJsonStore'
import { sshIdentitySchema } from '../../shared/schemas'
import type { SshIdentity } from '../../shared/contracts'

export class IdentityRepository {
  readonly store: AtomicJsonStore<SshIdentity[]>
  constructor(file: string) {
    this.store = new AtomicJsonStore(file, z.array(sshIdentitySchema), [])
  }
  list() {
    return this.store.read()
  }
  async save(identity: SshIdentity) {
    const clean = sshIdentitySchema.parse(identity)
    await this.store.update((items) => [...items.filter((item) => item.id !== clean.id), clean])
    return clean
  }
  remove(id: string) {
    return this.store.update((items) => items.filter((item) => item.id !== id)).then(() => {})
  }
  flush() {
    return this.store.flush()
  }
}
