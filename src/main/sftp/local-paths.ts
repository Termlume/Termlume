import { resolve, relative, isAbsolute, dirname, join } from 'node:path'
import { realpath, lstat } from 'node:fs/promises'
import { AppError } from '../../shared/errors'
export function validateFileName(name: string, platform: string = process.platform): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[/\x00-\x1f]/.test(name) ||
    (platform === 'win32' &&
      (/[\\:]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)))
  )
    throw new AppError('unsafe-name', 'Недопустимое имя файла')
  return name
}
function inside(root: string, target: string) {
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
    throw new AppError('unsafe-path', 'Путь находится за пределами выбранной папки')
}
export async function ensureLocalPath(
  root: string,
  path: string,
  allowMissing = false,
): Promise<string> {
  const canonicalRoot = await realpath(root),
    target = resolve(root, path)
  try {
    const canonical = await realpath(target)
    inside(canonicalRoot, canonical)
    return canonical
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await realpath(dirname(target))
    inside(canonicalRoot, parent)
    return join(parent, validateFileName(target.slice(dirname(target).length + 1)))
  }
}
export async function safeDownloadTarget(
  root: string,
  directory: string,
  name: string,
): Promise<string> {
  validateFileName(name)
  const parent = await ensureLocalPath(root, directory)
  const target = join(parent, name)
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new AppError('unsafe-link', 'Файл назначения является символической ссылкой')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return ensureLocalPath(root, target, true)
}
