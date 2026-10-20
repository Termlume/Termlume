export function HistoryChart({
  values,
  max = 100,
  color = 'var(--accent)',
  label,
}: {
  values: (number | undefined)[]
  max?: number
  color?: string
  label: string
}) {
  const valid = values.filter(
      (value): value is number => value !== undefined && Number.isFinite(value),
    ),
    ceiling = Math.max(1, max, ...valid)
  let path = '',
    pen = false
  values.forEach((value, index) => {
    if (value === undefined || !Number.isFinite(value)) {
      pen = false
      return
    }
    const x = values.length > 1 ? (index / (values.length - 1)) * 240 : 0,
      y = 46 - (Math.max(0, value) / ceiling) * 40
    path += (pen ? ' L' : ' M') + x.toFixed(1) + ',' + y.toFixed(1)
    pen = true
  })
  return (
    <svg
      className="history-chart"
      viewBox="0 0 240 50"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d="M0 46H240" stroke="var(--border)" strokeWidth="1" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
