import { AppError } from '../../shared/errors'

export const CURRENT_SCHEMA_VERSION = 1

export function migrateData(
  input: unknown,
  fromVersion: number,
  toVersion = CURRENT_SCHEMA_VERSION,
): unknown {
  if (
    !Number.isInteger(fromVersion) ||
    !Number.isInteger(toVersion) ||
    fromVersion < 0 ||
    toVersion > CURRENT_SCHEMA_VERSION ||
    fromVersion > toVersion
  )
    throw new AppError('storage-version', 'Неподдерживаемая версия данных')
  let data = input
  for (let version = fromVersion; version < toVersion; version++) {
    if (version === 0) data = migrateV0ToV1(data)
    else throw new AppError('storage-version', 'Неподдерживаемая версия данных')
  }
  return data
}

function migrateV0ToV1(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AppError(
      'corrupt-data',
      'Файл данных повреждён. Исходный файл сохранён для восстановления.',
    )
  return input
}
