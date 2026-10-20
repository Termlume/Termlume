import { useRef } from 'react'
export function ResizeHandle({
  axis = 'x',
  reverse = false,
  label = 'Изменить размер панели',
  value,
  min,
  max,
  onChange,
  onCommit,
}: {
  axis?: 'x' | 'y'
  reverse?: boolean
  label?: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
}) {
  const drag = useRef<{ origin: number; initial: number; current: number } | undefined>(undefined)
  return (
    <div
      className={'resize-handle ' + (axis === 'y' ? 'horizontal' : '')}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          origin: axis === 'x' ? event.clientX : event.clientY,
          initial: value,
          current: value,
        }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const delta = (axis === 'x' ? event.clientX : event.clientY) - drag.current.origin
        const next = Math.max(
          min,
          Math.min(max, drag.current.initial + delta * (axis === 'y' || reverse ? -1 : 1)),
        )
        drag.current.current = next
        onChange(next)
      }}
      onPointerCancel={() => {
        drag.current = undefined
      }}
      onPointerUp={() => {
        if (drag.current) onCommit(drag.current.current)
        drag.current = undefined
      }}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          const next = Math.max(
            min,
            Math.min(
              max,
              value +
                (['ArrowRight', 'ArrowUp'].includes(event.key) ? 10 : -10) * (reverse ? -1 : 1),
            ),
          )
          onChange(next)
          onCommit(next)
        }
      }}
    />
  )
}
