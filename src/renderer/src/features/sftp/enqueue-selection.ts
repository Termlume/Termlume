import type { FileEntry } from '../../../../shared/contracts'

export async function enqueueSelection(
  sessionId: string,
  direction: 'upload' | 'download',
  sourceDirectory: string,
  targetDirectory: string,
  entries: FileEntry[],
) {
  const append = (directory: string, name: string, local: boolean) => {
    const windows = local || /^(?:[a-z]:[\\/]|\\\\)/i.test(directory)
    return directory.replace(/[\\/]$/, '') + (windows ? '\\' : '/') + name
  }
  for (const entry of entries) {
    if (entry.isSymlink) throw new Error('Передача символических ссылок не поддерживается')
    await window.terminalApi.files.enqueue({
      sessionId,
      direction,
      source: append(sourceDirectory, entry.name, direction === 'upload'),
      target: append(targetDirectory, entry.name, direction === 'download'),
      overwrite: false,
    })
  }
}
