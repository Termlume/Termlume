import type { MemoryUsage } from '../../../../shared/contracts'
import { bytes } from './format'

/** One capacity scale for RAM, swap and disks; missing data is never an empty disk. */
export function CapacityBar({ label, usage }: { label: string; usage?: MemoryUsage }) {
  if (
    !usage ||
    ![usage.total, usage.used, usage.available].every(Number.isFinite) ||
    usage.total <= 0 ||
    usage.used < 0 ||
    usage.available < 0
  )
    return null
  const used = Math.min(usage.total, usage.used)
  const available = Math.min(usage.total - used, usage.available)
  const usedPercent = (used / usage.total) * 100
  const freePercent = (available / usage.total) * 100
  return (
    <div className="capacity" aria-label={label}>
      <div
        className="capacity-track"
        role="img"
        aria-label={`Занято ${usedPercent.toFixed(0)}%, доступно ${freePercent.toFixed(0)}%`}
      >
        <span className="capacity-used" style={{ width: `${usedPercent}%` }} />
        <span className="capacity-free" style={{ width: `${freePercent}%` }} />
      </div>
      <div className="capacity-details">
        <span>
          {bytes(used)} / {bytes(usage.total)}
        </span>
        <strong>{usedPercent.toFixed(0)}%</strong>
      </div>
      <small>{bytes(available)} свободно</small>
    </div>
  )
}
