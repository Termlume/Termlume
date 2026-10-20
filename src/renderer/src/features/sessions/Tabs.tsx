import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Home, TerminalSquare, FolderSync, Star, Monitor, ChevronDown } from 'lucide-react'
import type { HostProfile, LocalShellProfile } from '../../../../shared/contracts'
import { shortcutKeys } from '../../app/keyboard-shortcuts'
import type { ShortcutBindings } from '../../../../shared/keyboard-shortcuts'
import type { SessionTab } from './useSessions'
export const stateLabels: Record<string, string> = {
  connecting: 'Подключение…',
  'awaiting-auth': 'Аутентификация',
  'awaiting-host-verification': 'Проверка сервера',
  connected: 'Подключено',
  disconnected: 'Связь потеряна',
  error: 'Ошибка',
  closing: 'Завершение',
  reconnecting: 'Переподключение…',
}
export function Tabs({
  tabs,
  active,
  onSelect,
  onClose,
  onNew,
  favorites = [],
  onOpenHost,
  onOpenLocal,
  defaultLocalShell = 'powershell',
  shortcutBindings,
}: {
  tabs: SessionTab[]
  active?: string
  onSelect: (id?: string) => void
  onClose: (id: string) => void
  onNew: () => void
  favorites?: HostProfile[]
  onOpenHost?: (profile: HostProfile) => void
  onOpenLocal?: (shell: LocalShellProfile['shell']) => void
  defaultLocalShell?: LocalShellProfile['shell']
  shortcutBindings?: ShortcutBindings
}) {
  const [menu, setMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!menu) return
    const trigger = triggerRef.current
    const popup = menuRef.current
    if (!trigger || !popup) return
    const anchor = trigger.getBoundingClientRect()
    const bounds = popup.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - bounds.width - margin))
    const below = anchor.bottom + 4
    const top =
      below + bounds.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - bounds.height - 4)
    setMenuPosition({ top, left })
  }, [menu])

  const toggleMenu = () => {
    setMenuPosition(undefined)
    setMenu((value) => !value)
  }

  return (
    <>
      <button
        className={'home-tab-button ' + (!active ? 'selected' : '')}
        onClick={() => onSelect(undefined)}
        aria-label="Обзор подключений"
      >
        <Home size={15} />
      </button>
      {tabs.map((tab) => (
        <div key={tab.id} className={'session-tab ' + (active === tab.id ? 'selected' : '')}>
          <button className="tab-select" onClick={() => onSelect(tab.id)} title={tab.profile.name}>
            {tab.profile.protocol === 'sftp' || tab.profile.protocol === 'ftp' ? (
              <FolderSync size={14} />
            ) : (
              <TerminalSquare size={14} />
            )}
            <span>{tab.profile.name}</span>
            <i className={'tab-status ' + tab.state} />
          </button>
          <button
            className="tab-close"
            onClick={() => onClose(tab.id)}
            aria-label={'Закрыть: ' + tab.profile.name}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="new-tab-menu-wrap">
        <button
          className="new-tab-button"
          onClick={() => onOpenLocal?.(defaultLocalShell)}
          aria-label="Новая вкладка"
        >
          <Plus size={17} />
        </button>
        <button
          className="new-tab-menu-trigger"
          ref={triggerRef}
          onClick={toggleMenu}
          aria-label="Меню новой вкладки: локальная консоль, избранное и подключение"
          aria-expanded={menu}
          aria-haspopup="menu"
        >
          <ChevronDown size={11} />
        </button>
        {menu &&
          createPortal(
            <div
              ref={menuRef}
              className="new-tab-menu"
              role="menu"
              aria-label="Новая вкладка"
              style={{ top: menuPosition?.top ?? 0, left: menuPosition?.left ?? 0 }}
            >
              <div className="new-tab-menu-purpose">
                Локальная консоль, избранное или новое подключение
                <span className="new-tab-menu-hint">
                  {shortcutKeys('new-local', shortcutBindings)} ·{' '}
                  {shortcutKeys('new-connection', shortcutBindings)}
                </span>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  onOpenLocal?.('powershell')
                }}
              >
                <Monitor size={14} /> PowerShell
                {defaultLocalShell === 'powershell' ? ' · по умолчанию' : ''}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  onOpenLocal?.('cmd')
                }}
              >
                <TerminalSquare size={14} /> Command Prompt
                {defaultLocalShell === 'cmd' ? ' · по умолчанию' : ''}
              </button>
              {favorites.length > 0 && <div className="new-tab-menu-label">ИЗБРАННОЕ</div>}
              {favorites.map((host) => (
                <button
                  key={host.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    onOpenHost?.(host)
                  }}
                >
                  <Star size={14} /> <span>{host.name}</span>
                </button>
              ))}
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  onNew()
                }}
              >
                <Plus size={14} /> Новое подключение…{' '}
                <kbd aria-hidden="true">{shortcutKeys('new-connection', shortcutBindings)}</kbd>
              </button>
            </div>,
            document.body,
          )}
      </div>
    </>
  )
}
