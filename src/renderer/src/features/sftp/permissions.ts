export function permissionsToRwx(mode: number): string {
  return [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    .map((bit, index) => (mode & bit ? 'rwx'[index % 3] : '-'))
    .join('')
}

export function rwxToPermissions(rwx: string, originalMode: number): number {
  if (!/^[r-][w-][x-][r-][w-][x-][r-][w-][x-]$/.test(rwx))
    throw new Error('Invalid rwx permissions')
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
  return (
    (originalMode & 0o7000) |
    bits.reduce((mode, bit, index) => (rwx[index] === '-' ? mode : mode | bit), 0)
  )
}
