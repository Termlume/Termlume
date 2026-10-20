import * as fs from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors'

type Journal = {
  version: 1
  id: string
  state: 'prepared' | 'committed'
  entries: { target: string; stage: string; backup: string; existed: boolean }[]
}

export class DataImportTransaction {
  private journalPath: string
  constructor(private root: string) {
    this.root = resolve(root)
    this.journalPath = join(this.root, 'terminal-import.journal.json')
  }

  async apply(replacements: Map<string, string>): Promise<void> {
    await this.prepare(replacements)
    try {
      await this.commit()
    } catch (error) {
      await DataImportTransaction.recover(this.root)
      throw error
    }
  }

  async prepare(replacements: Map<string, string>): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    if (replacements.size < 1 || replacements.size > 20)
      throw new AppError('import-invalid', 'Неверный набор файлов для импорта')
    try {
      await fs.access(this.journalPath)
      throw new AppError('import-in-progress', 'Нужно восстановить предыдущий импорт')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const id = randomUUID(),
      entries: Journal['entries'] = []
    for (const [candidate, contents] of replacements) {
      const target = resolve(candidate)
      this.assertInside(target)
      if (!isAbsolute(candidate) || typeof contents !== 'string')
        throw new AppError('import-invalid', 'Неверный путь данных для импорта')
      await assertNoSymlinkComponents(this.root, target)
      const stage = `${target}.import-stage-${id}`,
        backup = `${target}.import-backup-${id}`
      await writeDurable(stage, contents)
      let existed = true
      try {
        await fs.copyFile(target, backup)
        await syncFile(backup)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        existed = false
      }
      entries.push({ target, stage, backup, existed })
    }
    await writeJournal(this.journalPath, { version: 1, id, state: 'prepared', entries })
  }

  async commit(): Promise<void> {
    const journal = await readJournal(this.journalPath, this.root)
    try {
      for (const entry of journal.entries) await fs.rename(entry.stage, entry.target)
      await writeJournal(this.journalPath, { ...journal, state: 'committed' })
      await cleanup(journal, this.journalPath)
    } catch (error) {
      await DataImportTransaction.recover(this.root)
      throw error
    }
  }

  static async recover(root: string): Promise<void> {
    const absoluteRoot = resolve(root),
      path = join(absoluteRoot, 'terminal-import.journal.json')
    let journal: Journal
    try {
      journal = await readJournal(path, absoluteRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (journal.state === 'prepared') {
      for (const entry of journal.entries) {
        await assertNoSymlinkComponents(absoluteRoot, entry.target)
        if (entry.existed) {
          try {
            await fs.access(entry.backup)
          } catch {
            throw new AppError(
              'import-recovery',
              'Не найдена резервная копия для восстановления импорта',
            )
          }
          const recovery = `${entry.target}.import-recovery-${journal.id}`
          await fs.copyFile(entry.backup, recovery)
          await fs.rename(recovery, entry.target)
          await syncFile(entry.target)
        } else await fs.rm(entry.target, { force: true })
      }
    }
    await cleanup(journal, path)
  }

  private assertInside(target: string) {
    const rel = relative(this.root, target)
    if (
      !rel ||
      rel === '..' ||
      rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
      isAbsolute(rel)
    )
      throw new AppError('import-invalid', 'Путь импорта выходит за пределы папки данных')
  }
}

async function writeDurable(path: string, value: string) {
  await fs.mkdir(dirname(path), { recursive: true })
  const handle = await fs.open(path, 'w', 0o600)
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncFile(path: string) {
  const handle = await fs.open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeJournal(path: string, journal: Journal) {
  const temporary = `${path}.${journal.id}.tmp`
  await writeDurable(temporary, JSON.stringify(journal))
  await fs.rename(temporary, path)
}

async function readJournal(path: string, root: string): Promise<Journal> {
  const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object')
    throw new AppError('import-recovery', 'Журнал импорта повреждён')
  const journal = parsed as Journal
  if (
    journal.version !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(journal.id) ||
    !['prepared', 'committed'].includes(journal.state) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length < 1 ||
    journal.entries.length > 20
  )
    throw new AppError('import-recovery', 'Журнал импорта повреждён')
  for (const entry of journal.entries) {
    const target = resolve(entry.target)
    const rel = relative(resolve(root), target)
    if (
      !entry ||
      typeof entry.existed !== 'boolean' ||
      !isAbsolute(entry.target) ||
      !isAbsolute(entry.stage) ||
      !isAbsolute(entry.backup) ||
      !rel ||
      rel.startsWith('..') ||
      isAbsolute(rel) ||
      entry.stage !== `${target}.import-stage-${journal.id}` ||
      entry.backup !== `${target}.import-backup-${journal.id}`
    )
      throw new AppError('import-recovery', 'Журнал импорта содержит небезопасный путь')
    await assertNoSymlinkComponents(resolve(root), target)
  }
  return journal
}

async function assertNoSymlinkComponents(root: string, target: string) {
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new AppError('import-recovery', 'Путь импорта выходит за пределы папки данных')
  let current = root
  for (const component of [root, ...rel.split(/[\\/]/).map((part) => (current = join(current, part)))]) {
    try {
      if ((await fs.lstat(component)).isSymbolicLink())
        throw new AppError('import-recovery', 'Небезопасная символическая ссылка в пути импорта')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}

async function cleanup(journal: Journal, path: string) {
  await Promise.all(
    journal.entries.flatMap((entry) => [
      fs.rm(entry.stage, { force: true }),
      fs.rm(entry.backup, { force: true }),
    ]),
  )
  await fs.rm(path, { force: true })
}
