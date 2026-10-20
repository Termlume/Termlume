import { AtomicJsonStore } from './AtomicJsonStore'
import { settingsSchema } from '../../shared/schemas'
import type { Settings } from '../../shared/contracts'
export class SettingsRepository {
  private store: AtomicJsonStore<Settings>
  constructor(file: string) {
    this.store = new AtomicJsonStore(file, settingsSchema, settingsSchema.parse({}))
  }
  get() {
    return this.store.read()
  }
  get warning() {
    return this.store.warning
  }
  get path() {
    return this.store.path
  }
  serialize(value: Settings) {
    return this.store.serialize(value)
  }
  flush() {
    return this.store.flush()
  }
  update(patch: Partial<Settings>) {
    return this.store.update((current) => settingsSchema.parse({ ...current, ...patch }))
  }
}
