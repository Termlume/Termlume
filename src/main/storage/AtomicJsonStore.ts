import * as fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import { AppError } from '../../shared/errors'
import { CURRENT_SCHEMA_VERSION, migrateData } from './migrations'
export class AtomicJsonStore<T> {
  warning?: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    readonly file: string,
    private schema: ZodType<T>,
    private initial: T,
    private io: typeof fs = fs,
  ) {}
  get path() {
    return this.file
  }
  async read(): Promise<T> {
    try {
      return this.decode(await this.io.readFile(this.file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.initial)
      if (error instanceof AppError && error.code === 'storage-version') throw error
      try {
        const backup = this.decode(await this.io.readFile(this.file + '.bak', 'utf8'))
        this.warning = 'Повреждён основной файл данных. Загружена резервная копия.'
        return backup
      } catch {
        throw new AppError(
          'corrupt-data',
          'Файл данных повреждён. Исходный файл сохранён для восстановления.',
        )
      }
    }
  }
  private decode(text: string): T {
    const document = JSON.parse(text)
    const version = document.schemaVersion ?? document.version
    if (!Number.isInteger(version) || version > CURRENT_SCHEMA_VERSION)
      throw new AppError('storage-version', 'Неподдерживаемая версия данных')
    return this.schema.parse(migrateData(document.data, version === 1 ? 1 : version))
  }
  serialize(value: T): string {
    return JSON.stringify(
      { schemaVersion: CURRENT_SCHEMA_VERSION, data: this.schema.parse(value) },
      null,
      2,
    )
  }
  write(value: T): Promise<void> {
    return this.update(() => value).then(() => {})
  }
  async flush(): Promise<void> {
    await this.queue
  }
  update(change: (current: T) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const current = await this.read(),
        next = this.schema.parse(change(current))
      await this.io.mkdir(dirname(this.file), { recursive: true })
      const temp = this.file + '.' + randomUUID() + '.tmp'
      try {
        await this.io.writeFile(temp, this.serialize(next), {
          encoding: 'utf8',
          mode: 0o600,
        })
        const handle = await this.io.open(temp, 'r+')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        try {
          await this.io.access(this.file)
          await this.io.writeFile(this.file + '.bak', this.serialize(current), { mode: 0o600 })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await this.io.rename(temp, this.file)
        this.warning = undefined
        return next
      } finally {
        await this.io.rm(temp, { force: true }).catch(() => {})
      }
    })
    this.queue = run.catch(() => {})
    return run
  }
}
