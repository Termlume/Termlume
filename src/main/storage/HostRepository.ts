import { z } from 'zod'
import { AtomicJsonStore } from './AtomicJsonStore'
import { hostSchema } from '../../shared/schemas'
import type { HostProfile } from '../../shared/contracts'
export class HostRepository {
  readonly store: AtomicJsonStore<HostProfile[]>
  constructor(file: string) {
    this.store = new AtomicJsonStore(file, z.array(hostSchema), [])
  }
  list() {
    return this.store.read()
  }
  async save(profile: HostProfile): Promise<HostProfile> {
    const clean = hostSchema.parse(profile)
    await this.store.update((items) => [...items.filter((item) => item.id !== clean.id), clean])
    return clean
  }
  async remove(id: string) {
    await this.store.update((items) => items.filter((item) => item.id !== id))
  }
}
