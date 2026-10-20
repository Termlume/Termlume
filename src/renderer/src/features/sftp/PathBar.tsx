import { useEffect, useState } from 'react'
import { RefreshCw, FolderOpen, FolderPlus, Pencil, Trash2, Shield } from 'lucide-react'
export function PathBar({
  path,
  onPath,
  onRefresh,
  onChoose,
  onAction,
  onPermissions,
  selected,
  capabilities,
}: {
  path: string
  onPath: (value: string) => void
  onRefresh: () => void
  onChoose?: () => void
  onAction: (action: 'mkdir' | 'rename' | 'remove') => void
  onPermissions?: () => void
  selected: number
  capabilities?: {
    mkdir: boolean
    rename: boolean
    remove: boolean
    chmod: boolean
    chown?: boolean
  }
}) {
  const [value, setValue] = useState(path)
  useEffect(() => setValue(path), [path])
  return (
    <>
      <form
        className="path-bar"
        onSubmit={(event) => {
          event.preventDefault()
          onPath(value)
        }}
      >
        <input
          aria-label={onChoose ? 'Локальный путь' : 'Удалённый путь'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {onChoose && (
          <button type="button" title="Выбрать локальную папку" onClick={onChoose}>
            <FolderOpen size={14} />
          </button>
        )}
        <button type="button" title="Обновить" onClick={onRefresh}>
          <RefreshCw size={13} />
        </button>
      </form>
      <div className="file-actions">
        <button
          disabled={capabilities?.mkdir === false}
          onClick={() => onAction('mkdir')}
          title="Новая папка"
        >
          <FolderPlus size={13} />
        </button>
        <button
          disabled={selected !== 1 || capabilities?.rename === false}
          onClick={() => onAction('rename')}
          title="Переименовать"
        >
          <Pencil size={12} />
        </button>
        <button
          disabled={selected !== 1 || capabilities?.remove === false}
          onClick={() => onAction('remove')}
          title="Удалить"
        >
          <Trash2 size={12} />
        </button>
        {onPermissions && (
          <button
            disabled={selected !== 1 || capabilities?.chmod === false}
            onClick={onPermissions}
            title="Изменить права доступа"
            aria-label="Изменить права доступа"
          >
            <Shield size={12} />
          </button>
        )}
      </div>
    </>
  )
}
