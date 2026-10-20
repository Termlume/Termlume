import type { ReactNode } from 'react'
import type { Metric } from '../../../../shared/contracts'
export function MetricCard<T>({
  label,
  metric,
  format,
  children,
}: {
  label: string
  metric: Metric<T>
  format: (value: T) => string
  children?: ReactNode
}) {
  return (
    <section className="metric-card">
      <div className="metric-label">
        {label}
        <span className={'metric-dot ' + metric.status} />
      </div>
      <div
        className={'metric-value ' + (metric.status !== 'ok' ? 'unavailable' : '')}
        title={metric.error}
      >
        {metric.status === 'ok' && metric.value !== undefined
          ? format(metric.value)
          : metric.status === 'warming-up'
            ? 'Измерение…'
            : 'Недоступно'}
      </div>
      {metric.status !== 'ok' && metric.error && <p className="metric-reason">{metric.error}</p>}
      {children}
    </section>
  )
}
