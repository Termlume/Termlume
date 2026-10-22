export function meaningfulPasteLines(text: string): number {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0).length
}

export function needsPastePreview(text: string): boolean {
  return meaningfulPasteLines(text) > 1
}
