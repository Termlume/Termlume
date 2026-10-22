import type { FileEntry } from '../../../../shared/contracts'

export async function enqueueSelection(
  sessionId: string,
  direction: 'upload' | 'download',
  sourceDirectory: string,
  targetDirectory: string,
  entries: FileEntry[],
  chooseDestination?: boolean,
) {
  if (
    direction === 'download' &&
    chooseDestination !== false &&
    window.terminalApi.files.downloadDestination
  ) {
    const destination = await window.terminalApi.files.downloadDestination(chooseDestination)
    if (!destination) return
    targetDirectory = destination
  }
  const append = (directory: string, name: string, local: boolean) => {
    const windows = local || /^(?:[a-z]:[\\/]|\\\\)/i.test(directory)
    return directory.replace(/[\\/]$/, '') + (windows ? '\\' : '/') + name
  }
  const batchId = crypto.randomUUID()
  for (const entry of entries) {
    if (entry.isSymlink) throw new Error('Передача символических ссылок не поддерживается')
    await window.terminalApi.files.enqueue({
      sessionId,
      batchId,
      direction,
      source: append(sourceDirectory, entry.name, direction === 'upload'),
      target: append(targetDirectory, entry.name, direction === 'download'),
      overwrite: false,
    })
  }
}
