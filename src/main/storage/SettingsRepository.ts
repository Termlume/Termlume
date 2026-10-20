import { AtomicJsonStore } from './AtomicJsonStore'
import { settingsSchema } from '../../shared/schemas'
import type { Settings } from '../../shared/contracts'
export class SettingsRepository {
  private store: AtomicJsonStore<Settings>
  constructor(file: string) {
    this.store = new AtomicJsonStore(file, settingsSchema, settingsSchema.parse({}))
  }
  async get() {
    const settings = await this.store.read()
    if (settings.updateChannelPolicy === 1) return settings
    return this.store.update((current) =>
      current.updateChannelPolicy === 1
        ? current
        : settingsSchema.parse({ ...current, updateChannel: 'prerelease', updateChannelPolicy: 1 }),
    )
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
    return this.store.update((current) =>
      settingsSchema.parse({
        ...current,
        ...(current.updateChannelPolicy !== 1 ? { updateChannel: 'prerelease' } : {}),
        ...patch,
        updateChannelPolicy: 1,
      }),
    )
  }
}
