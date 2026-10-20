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
}: {
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
          <span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span>
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
        <kbd>⌕</kbd>
      </label>
      <button className={'sidebar-filter ' + (favoriteOnly ? 'selected' : '')} onClick={onFavorite}>
        <Star size={15} />
        {ru.favorites}
      </button>
      <div className="section-heading">
        <ChevronDown size={12} />
        <span>{ru.allHosts}</span>
      </div>
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
    </>
  )
}
