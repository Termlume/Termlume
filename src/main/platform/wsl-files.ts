import { AppError } from '../../shared/errors'

export async function resolveWslRoot(
  distribution: string,
  run: (distribution: string) => Promise<string>,
): Promise<string> {
  if (!distribution.trim())
    throw new AppError('wsl-distribution-required', 'Выберите дистрибутив WSL')
  let output: string
  try {
    output = await run(distribution)
  } catch {
    throw new AppError(
      'wsl-files-unavailable',
      `Не удалось открыть файлы дистрибутива «${distribution}»`,
      true,
    )
  }
  const root = output
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
  if (!/^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+$/i.test(root))
    throw new AppError(
      'wsl-files-unavailable',
      `Проводник Windows не видит файлы дистрибутива «${distribution}»`,
      true,
    )
  const rootDistribution = root.slice(root.lastIndexOf('\\') + 1)
  if (rootDistribution.toLowerCase() !== distribution.toLowerCase())
    throw new AppError(
      'wsl-files-unavailable',
      'Корень WSL не совпадает с выбранным дистрибутивом',
      true,
    )
  return root
}
