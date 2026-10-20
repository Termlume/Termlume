import { ArrowUpRight, ArrowRight, TerminalSquare, Monitor, Command } from 'lucide-react'
import { ru } from './ru'
export function Workspace({ onNew, onWsl }: { onNew: () => void; onWsl: () => void }) {
  return (
    <div className="welcome-page">
      <div className="page-toolbar">
        <div>
          <span className="eyebrow">ОБЗОР</span>
          <h2>{ru.connections}</h2>
        </div>
        <button className="primary-button" onClick={onNew}>
          <span>+</span>
          {ru.newConnection}
        </button>
      </div>
      <div className="welcome-content">
        <div className="welcome-symbol">
          <TerminalSquare size={38} strokeWidth={1.35} />
          <span className="symbol-spark" />
        </div>
        <div className="welcome-kicker">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <h1>{ru.welcome}</h1>
        <p className="welcome-description">{ru.welcomeDescription}</p>
        <div className="start-cards">
          <button className="start-card" onClick={onNew}>
            <span className="card-icon">
              <TerminalSquare size={21} />
            </span>
            <span>
              <strong>{ru.sshCard}</strong>
              <small>{ru.sshHint}</small>
            </span>
            <ArrowUpRight size={18} />
          </button>
          <button className="start-card" onClick={onWsl}>
            <span className="card-icon local">
              <Monitor size={21} />
            </span>
            <span>
              <strong>{ru.wslCard}</strong>
              <small>{ru.wslHint}</small>
            </span>
            <ArrowUpRight size={18} />
          </button>
        </div>
        <button className="welcome-link" onClick={onNew}>
          Создать первое подключение
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="welcome-bottom">
        <Command size={14} />
        <span>Меньше переключений. Больше контроля.</span>
        <span className="local-pill">Локально на вашем устройстве</span>
      </div>
    </div>
  )
}
