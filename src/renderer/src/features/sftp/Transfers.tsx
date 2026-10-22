import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, X, RotateCcw, Check, FolderOpen, Trash2 } from 'lucide-react'
import type { TransferSnapshot } from '../../../../shared/contracts'
const labels = {
  queued: 'В очереди',
  running: 'Передача',
  completed: 'Готово',
  failed: 'Ошибка',
  canceled: 'Отменено',
}
export function Transfers({
  onFinished,
  sessionId,
  compact = false,
}: {
  onFinished?: () => void
  sessionId?: string
  compact?: boolean
}) {
  const [entries, setEntries] = useState<TransferSnapshot[]>([]),
    [replace, setReplace] = useState<TransferSnapshot>(),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(!compact)
  useEffect(() => {
    window.terminalApi.files
      .transfers()
      .then(setEntries)
      .catch((error) => setError(String(error)))
    return window.terminalApi.files.onTransfer((entry) => {
      setEntries((current) =>
        [...current.filter((item) => item.id !== entry.id), entry].slice(-200),
      )
      if (entry.state === 'completed') onFinished?.()
    })
  }, [])
  async function retry(entry: TransferSnapshot, overwrite = false) {
    try {
      await window.terminalApi.files.retry(
        entry.id,
        overwrite,
        overwrite ? entry.conflict : undefined,
      )
      setReplace(undefined)
    } catch (error) {
      setError(String(error))
    }
  }
  const activeCount = entries.filter((entry) => ['running', 'queued'].includes(entry.state)).length,
    hiddenCompletedCount = entries.filter((entry) => entry.state === 'completed').length,
    completedCount = entries.filter(
      (entry) => entry.sessionId === sessionId && entry.state === 'completed',
    ).length
  return (
    <div className={'transfers ' + (!expanded ? 'collapsed' : '')}>
      {!expanded ? (
        <button
          className="transfer-restore"
          aria-label={`Показать очередь передач (${activeCount} активных)`}
          onClick={() => setExpanded(true)}
        >
          Очередь передач · {activeCount} активных · {hiddenCompletedCount} готово
        </button>
      ) : (
        <>
          <div className="transfer-heading">
            Очередь передач <span>{activeCount} активных</span>
            <div className="transfer-controls">
              {completedCount > 0 && sessionId && (
                <button
                  aria-label="Очистить завершённые"
                  title="Очистить завершённые"
                  onClick={async () => {
                    try {
                      await window.terminalApi.files.clearCompleted(sessionId)
                      setEntries((current) =>
                        current.filter(
                          (entry) => entry.sessionId !== sessionId || entry.state !== 'completed',
                        ),
                      )
                    } catch (error) {
                      setError(String(error))
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button
                aria-label="Скрыть очередь передач"
                title="Скрыть очередь передач"
                onClick={() => setExpanded(false)}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          {entries
            .slice(-20)
            .reverse()
            .map((entry) => (
              <div className={'transfer-row ' + entry.state} key={entry.id}>
                {entry.direction === 'upload' ? (
                  <ArrowUpRight size={13} />
                ) : (
                  <ArrowDownLeft size={13} />
                )}
                <div className="transfer-info">
                  <strong title={entry.source}>{entry.source.split(/[\\/]/).at(-1)}</strong>
                  <small>
                    Назначение: {entry.target}
                    <br />
                    {entry.error?.message || labels[entry.state]} ·{' '}
                    {Math.round(entry.bytesDone / 1024)} / {Math.round(entry.bytesTotal / 1024)} KB
                  </small>
                  {entry.state === 'running' && (
                    <progress max={Math.max(1, entry.bytesTotal)} value={entry.bytesDone} />
                  )}
                </div>
                {entry.state === 'completed' ? (
                  entry.direction === 'download' ? (
                    <button
                      aria-label="Открыть файл"
                      title="Открыть файл"
                      onClick={() =>
                        window.terminalApi.files
                          .openLocal(entry.target)
                          .catch((error) => setError(String(error)))
                      }
                    >
                      <FolderOpen size={13} />
                    </button>
                  ) : (
                    <Check size={13} />
                  )
                ) : ['running', 'queued'].includes(entry.state) ? (
                  <button
                    title="Отменить передачу"
                    onClick={() =>
                      window.terminalApi.files
                        .cancel(entry.id)
                        .catch((error) => setError(String(error)))
                    }
                  >
                    <X size={13} />
                  </button>
                ) : (
                  <button
                    title={entry.conflict ? 'Заменить файл' : 'Повторить'}
                    onClick={() => (entry.conflict ? setReplace(entry) : void retry(entry))}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                {entry.state === 'completed' && entry.direction === 'download' && (
                  <button
                    title="Показать в папке"
                    aria-label="Показать в папке"
                    onClick={() =>
                      window.terminalApi.files
                        .showLocal(entry.target)
                        .catch((error) => setError(String(error)))
                    }
                  >
                    ↗
                  </button>
                )}
              </div>
            ))}
          {error && <p className="error-message">{error}</p>}
          {entries.length === 0 && !error && <p className="transfer-empty">Нет передач</p>}
          {replace && (
            <div className="modal-backdrop">
              <section className="modal" role="dialog" aria-label="Перезапись файла">
                <h2>Заменить существующий файл?</h2>
                <p className="muted small">{replace.target}</p>
                <p className="muted small">
                  Размер: {replace.conflict?.size} байт. Изменён:{' '}
                  {new Date(replace.conflict?.modifiedAt || 0).toLocaleString('ru-RU')}.
                  Существующее содержимое будет заменено после успешной передачи.
                </p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setReplace(undefined)}>
                    Отмена
                  </button>
                  <button className="primary-button" onClick={() => retry(replace, true)}>
                    Заменить файл
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
