import {
  Server,
  Cpu,
  MemoryStick,
  ArrowUp,
  ArrowDown,
  Network,
  Activity,
  Files,
  Clock3,
  Users,
  HardDrive,
  FolderSymlink,
  Thermometer,
} from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'

const HoverContext = createContext<{
  expanded?: boolean
  active?: string
  setActive: Dispatch<SetStateAction<string | undefined>>
}>({
  setActive: () => {},
})
export function MonitoringHoverGroup({
  children,
  expanded = false,
}: {
  children: ReactNode
  expanded?: boolean
}) {
  const [active, setActive] = useState<string>()
  return (
    <HoverContext.Provider value={{ active, setActive, expanded }}>
      {children}
    </HoverContext.Provider>
  )
}

export function MonitoringHover({
  label,
  value,
  children,
}: {
  label: string
  value: ReactNode
  children: ReactNode
}) {
  const Icon =
    (
      {
        Сервер: Server,
        CPU: Cpu,
        RAM: MemoryStick,
        '↑': ArrowUp,
        '↓': ArrowDown,
        Соединения: Network,
        Процессы: Activity,
        Дескрипторы: Files,
        Uptime: Clock3,
        Пользователи: Users,
        Диски: HardDrive,
        NFS: FolderSymlink,
        Температуры: Thermometer,
      } as Record<string, typeof Cpu>
    )[label] || (label.startsWith('/') ? HardDrive : undefined)
  const { active, setActive, expanded } = useContext(HoverContext)
  const id = useId()
  const open = active === id
  const setOpen = (value: boolean) => {
    if (value) setActive(id)
    else setActive((current) => (current === id ? undefined : current))
  }
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelClose = () => {
    clearTimeout(timer.current)
  }
  const show = () => {
    cancelClose()
    setOpen(true)
  }
  const closeSoon = () => {
    cancelClose()
    timer.current = setTimeout(() => setOpen(false), 160)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelClose()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const positionPopup = () => {
      const anchor = trigger.current?.getBoundingClientRect(),
        box = popup.current?.getBoundingClientRect()
      if (!anchor || !box) return
      setPosition({
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
        top: Math.max(8, anchor.top - box.height - 8),
      })
    }
    positionPopup()
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionPopup)
    if (popup.current) observer?.observe(popup.current)
    window.addEventListener('resize', positionPopup)
    window.addEventListener('scroll', positionPopup, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', positionPopup)
      window.removeEventListener('scroll', positionPopup, true)
    }
  }, [open])
  if (expanded)
    return (
      <section className="metric-card">
        <div className="metric-label">{label}</div>
        <strong>{value}</strong>
        {children}
      </section>
    )
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="monitoring-item"
        aria-label={`${label}: ${typeof value === 'string' ? value : ''}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={closeSoon}
        onFocus={show}
        onBlur={closeSoon}
        onClick={show}
      >
        <span className="monitoring-item-label">
          {Icon ? <Icon size={14} aria-hidden="true" /> : label}
        </span>
        {label.startsWith('/') && <span>{label}</span>} <b>{value}</b>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="tooltip"
            className="monitoring-popover"
            style={position}
            onMouseEnter={cancelClose}
            onMouseLeave={closeSoon}
            onFocus={cancelClose}
            onBlur={closeSoon}
          >
            <strong className="monitoring-popover-heading">{label}</strong>
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
