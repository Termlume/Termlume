import { z } from 'zod'
import { AtomicJsonStore } from './AtomicJsonStore'
import { AppError } from '../../shared/errors'
export interface CryptoProvider {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
export class SecretVault {
  private store: AtomicJsonStore<Record<string, string>>
  constructor(
    file: string,
    private crypto: CryptoProvider,
  ) {
    this.store = new AtomicJsonStore(file, z.record(z.string(), z.string()), {})
  }
  get path() {
    return this.store.path
  }
  serialize(value: Record<string, string>) {
    return this.store.serialize(value)
  }
  async exportPlaintext(): Promise<Record<string, string>> {
    const encrypted = await this.store.read(),
      plain: Record<string, string> = {}
    for (const reference of Object.keys(encrypted)) {
      const value = await this.get(reference)
      if (value !== undefined) plain[reference] = value
    }
    return plain
  }
  exportEncrypted() {
    return this.store.read()
  }
  encryptAll(values: Record<string, string>): Record<string, string> {
    if (Object.keys(values).length && !this.crypto.available())
      throw new AppError(
        'encryption-unavailable',
        'Защита Windows недоступна. Импорт секретов отменён.',
      )
    return Object.fromEntries(
      Object.entries(values).map(([reference, value]) => [
        reference,
        this.crypto.encrypt(value).toString('base64'),
      ]),
    )
  }
  async get(ref: string): Promise<string | undefined> {
    const data = await this.store.read()
    if (!data[ref]) return undefined
    if (!this.crypto.available())
      throw new AppError(
        'secret-unavailable',
        'Защищённое хранилище недоступно. Введите секрет заново.',
      )
    try {
      return this.crypto.decrypt(Buffer.from(data[ref], 'base64'))
    } catch {
      throw new AppError('secret-unavailable', 'Не удалось расшифровать сохранённый секрет')
    }
  }
  async set(ref: string, value: string): Promise<void> {
    if (!this.crypto.available())
      throw new AppError('encryption-unavailable', 'Защита Windows недоступна. Секрет не сохранён.')
    const encrypted = this.crypto.encrypt(value).toString('base64')
    await this.store.update((data) => ({ ...data, [ref]: encrypted }))
  }
  async remove(ref: string) {
    await this.store.update((data) => {
      const copy = { ...data }
      delete copy[ref]
      return copy
    })
  }
  flush() {
    return this.store.flush()
  }
}
