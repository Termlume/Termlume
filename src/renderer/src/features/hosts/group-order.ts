export function orderedGroups(groups: string[], saved: string[] = []): string[] {
  const present = new Set(groups)
  return [...new Set([...saved.filter((group) => present.has(group)), ...groups])]
}

export function moveGroup(
  groups: string[],
  source: string,
  target: string,
  position: 'before' | 'after',
): string[] {
  if (source === target || !groups.includes(source) || !groups.includes(target)) return groups
  const next = groups.filter((group) => group !== source)
  next.splice(next.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
  return next
}
