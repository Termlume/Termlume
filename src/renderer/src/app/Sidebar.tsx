import '../features/hosts/hosts.css'
import type { ReactNode } from 'react'
import { Plus, Search, Server, Star, ChevronDown } from 'lucide-react'
import { ru } from './ru'
export function Sidebar({
  children,
  onNew,
  search = '',
  onSearch = () => {},
  favoriteOnly = false,
  onFavorite = () => {},
  connectionsCollapsed = false,
  onToggleConnections = () => {},
}: {
  connectionsCollapsed?: boolean
  onToggleConnections?: () => void
  children?: ReactNode
  onNew: () => void
  search?: string
  onSearch?: (value: string) => void
  favoriteOnly?: boolean
  onFavorite?: () => void
}) {
  return (
    <>
      <div className="sidebar-heading">
        <div>
          <h2>{ru.connections}</h2>
        </div>
        <button className="icon-button new-icon" aria-label={ru.newConnection} onClick={onNew}>
          <Plus size={20} />
        </button>
      </div>
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label={ru.search}
          placeholder="Поиск..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {search ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Сбросить поиск"
            onClick={() => onSearch('')}
          >
            ×
          </button>
        ) : (
          <kbd>⌕</kbd>
        )}
      </label>
      <button className={'sidebar-filter ' + (favoriteOnly ? 'selected' : '')} onClick={onFavorite}>
        <Star size={15} />
        {ru.favorites}
      </button>
      <button
        type="button"
        className="section-heading"
        aria-expanded={!!search.trim() || !connectionsCollapsed}
        onClick={() => {
          if (!search.trim()) onToggleConnections()
        }}
      >
        <ChevronDown
          size={12}
          style={{
            transform: !search.trim() && connectionsCollapsed ? 'rotate(-90deg)' : undefined,
          }}
        />
        <span>{ru.allHosts}</span>
      </button>
      {(!!search.trim() || !connectionsCollapsed) && (
        <div className="host-scroll">
          {children || (
            <div className="sidebar-empty">
              <Server size={27} strokeWidth={1.3} />
              <p>{ru.noHosts}</p>
              <button className="text-button" onClick={onNew}>
                Добавить подключение <Plus size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
