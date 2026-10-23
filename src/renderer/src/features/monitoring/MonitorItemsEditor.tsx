import { useId, useLayoutEffect, useRef } from 'react'
import { GripVertical } from 'lucide-react'
import {
  MONITOR_ITEMS,
  MONITOR_ITEM_LABELS,
  moveMonitorItem,
  completeMonitorOrder,
  type MonitorItem,
} from '../../../../shared/monitoring-items'

export function MonitorItemsEditor({
  value,
  onChange,
  onReset,
  order,
}: {
  value: MonitorItem[]
  onChange: (items: MonitorItem[]) => void
  onReset?: () => void
  order?: MonitorItem[]
}) {
  const id = useId()
  const dragged = useRef<MonitorItem | undefined>(undefined)
  const arrowButtons = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | undefined>(undefined)
  // Keep unchecked rows in their own slots. A toggle changes selection, not row placement.
  const rowOrder = useRef(
    order
      ? completeMonitorOrder(order)
      : [...value, ...MONITOR_ITEMS.filter((item) => !value.includes(item))],
  )
  if (order) rowOrder.current = completeMonitorOrder(order)
  let enabledIndex = 0
  rowOrder.current = rowOrder.current.map((item) =>
    value.includes(item) ? value[enabledIndex++] : item,
  )
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      arrowButtons.current.get(pendingFocus.current)?.focus({ preventScroll: true })
      pendingFocus.current = undefined
    }
  }, [value])
  const move = (item: MonitorItem, direction: -1 | 1) => {
    const index = value.indexOf(item),
      target = value[index + direction]
    if (index < 0 || !target) return
    pendingFocus.current = `${item}:${direction}`
    onChange(moveMonitorItem(value, item, target))
  }
  return (
    <fieldset className="monitoring-items-settings monitoring-items-editor">
      <legend>Показатели и порядок</legend>
      <p className="monitoring-editor-hint">
        Перетащите включённый показатель или используйте кнопки ↑ ↓.
      </p>
      <div className="monitoring-editor-list">
        {rowOrder.current.map((item) => {
          const index = value.indexOf(item)
          return (
            <div
              className="monitor-item-setting"
              key={item}
              data-monitor-item={item}
              draggable={index >= 0}
              onDragStart={(event) => {
                dragged.current = item
                event.dataTransfer.setData('text/plain', item)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                dragged.current = undefined
              }}
              onDragOver={(event) => {
                if (dragged.current && index >= 0) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged.current) onChange(moveMonitorItem(value, dragged.current, item))
                dragged.current = undefined
              }}
            >
              <span className="monitor-item-grip" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <input
                id={`${id}-${item}`}
                type="checkbox"
                checked={index >= 0}
                onChange={() =>
                  onChange(
                    index >= 0
                      ? value.filter((i) => i !== item)
                      : rowOrder.current.filter((i) => i === item || value.includes(i)),
                  )
                }
              />
              <label className="monitor-item-name" htmlFor={`${id}-${item}`}>
                {MONITOR_ITEM_LABELS[item]}
              </label>
              {([-1, 1] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  ref={(button) => {
                    const key = `${item}:${direction}`
                    if (button) arrowButtons.current.set(key, button)
                    else arrowButtons.current.delete(key)
                  }}
                  aria-label={`${direction < 0 ? 'Поднять' : 'Опустить'}: ${MONITOR_ITEM_LABELS[item]}`}
                  aria-disabled={
                    index < 0 || (direction < 0 ? index === 0 : index === value.length - 1)
                  }
                  tabIndex={
                    index < 0 || (direction < 0 ? index === 0 : index === value.length - 1) ? -1 : 0
                  }
                  onClick={() => move(item, direction)}
                >
                  {direction < 0 ? '↑' : '↓'}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      {onReset && (
        <button className="monitoring-editor-reset" type="button" onClick={onReset}>
          Сбросить к общим настройкам
        </button>
      )}
    </fieldset>
  )
}
