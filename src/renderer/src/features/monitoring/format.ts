export function bytes(value: number): string {
  return value >= 1073741824
    ? (value / 1073741824).toFixed(1) + ' GB'
    : value >= 1048576
      ? (value / 1048576).toFixed(1) + ' MB'
      : value >= 1024
        ? (value / 1024).toFixed(1) + ' KB'
        : value.toFixed(0) + ' B'
}
