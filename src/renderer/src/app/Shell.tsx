import type { ReactNode } from 'react'
import {
  TerminalSquare,
  FolderOpen,
  Activity,
  Settings2,
  PanelsTopLeft,
  ShieldCheck,
  CircleHelp,
  Search,
} from 'lucide-react'
import { ru } from './ru'
import { APP_DISPLAY_VERSION } from '../../../shared/version'
interface Props {
  sidebar: ReactNode
  children: ReactNode
  tabs?: ReactNode
  onSettings: () => void
  onFiles: () => void
  onMonitor: () => void
  onHelp: () => void
  onHome: () => void
  onCommands?: () => void
  commandsShortcut?: string
  updateIndicator?: ReactNode
  footer?: ReactNode
}
export function Shell({
  sidebar,
  children,
  tabs,
  onSettings,
  onFiles,
  onMonitor,
  onHelp,
  onHome,
  onCommands,
  commandsShortcut = 'Ctrl+Shift+P',
  footer,
  updateIndicator,
}: Props) {
  return (
    <div className="shell">
      <div className="window-titlebar">
        <TerminalSquare size={14} />
        <span>Termlume</span>
      </div>
      <nav className="rail" aria-label="Навигация">
        <button className="brand" onClick={onHome} title={ru.app} aria-label={ru.connections}>
          <TerminalSquare size={27} />
        </button>
        <div className="rail-divider" />
        <button className="rail-button active" title={ru.connections} onClick={onHome}>
          <PanelsTopLeft size={21} />
        </button>
        <button className="rail-button" aria-label={ru.files} title={ru.files} onClick={onFiles}>
          <FolderOpen size={21} />
        </button>
        <button
          className="rail-button"
          aria-label={ru.monitoring}
          title={ru.monitoring}
          onClick={onMonitor}
        >
          <Activity size={21} />
        </button>
        <div className="rail-spacer" />
        {onCommands && (
          <button
            className="rail-button"
            aria-label="Поиск команд"
            title={`Поиск команд · ${commandsShortcut}`}
            onClick={onCommands}
          >
            <Search size={21} />
          </button>
        )}
        <button
          className="rail-button"
          aria-label={ru.settings}
          title={ru.settings}
          onClick={onSettings}
        >
          <Settings2 size={21} />
        </button>
        <button
          className="rail-button"
          aria-label="Горячие клавиши"
          title="Горячие клавиши"
          onClick={onHelp}
        >
          <CircleHelp size={21} />
        </button>
      </nav>
      <aside className="sidebar">
        {sidebar}
        <div className="sidebar-bottom">
          <ShieldCheck size={15} />
          <span>{ru.localStorage}</span>
          <span className="version">{APP_DISPLAY_VERSION}</span>
        </div>
      </aside>
      <section className="workspace">
        <header className="tabs-bar">
          {tabs || (
            <span className="home-tab">
              <PanelsTopLeft size={15} />
              {ru.workspace}
            </span>
          )}
        </header>
        {children}
      </section>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {ru.app}
        </span>
        {footer || <span>{ru.disconnected}</span>}
        <span className="status-end">
          {updateIndicator}
          WINDOWS <span className="status-separator">/</span> UTF-8
        </span>
      </footer>
    </div>
  )
}
