import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X, Sparkles } from 'lucide-react'
import type { Settings, UpdateStatus } from '../../../../shared/contracts'
import changelog from '../../../../../CHANGELOG.md?raw'
import { ReleaseNotes } from './ReleaseNotes'
import { changelogVersion } from './release-notes'
import './updates.css'
import { displayVersion } from '../../../../shared/version'

export function UpdateNotice({
  settings,
  onSaved,
  onOpenChange,
}: {
  settings: Settings
  onOpenChange?: (open: boolean) => void
  onSaved: (value: Settings) => void
}) {
  const [status, setStatus] = useState<UpdateStatus>()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const offered = useRef(new Set<string>())
  const dialogVersion = useRef<string | undefined>(undefined)
  const installWhenReady = useRef(false)
  const modal = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])
  useEffect(() => () => onOpenChange?.(false), [onOpenChange])
  useEffect(() => {
    const api = window.terminalApi.updates
    if (!api) return
    let live = true,
      changed = false
    const off = api.onStatus((value) => {
      changed = true
      if (live) setStatus(value)
    })
    void api
      .status()
      .then((value) => {
        if (live && !changed) setStatus(value)
      })
      .catch(() => {})
    return () => {
      live = false
      off()
      installWhenReady.current = false
    }
  }, [])
  const actionable =
    !!status && ['available', 'downloading', 'downloaded', 'installing'].includes(status.state)
  useEffect(() => {
    if (!status?.version || !['available', 'downloaded'].includes(status.state)) return
    if (settings.dismissedUpdateVersion === status.version || offered.current.has(status.version))
      return
    dialogVersion.current = status.version
    offered.current.add(status.version)
    setOpen(true)
  }, [status?.state, status?.version, settings.dismissedUpdateVersion])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    modal.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])
  async function later() {
    installWhenReady.current = false
    setOpen(false)
    const version = dialogVersion.current
    if (!version) return
    try {
      onSaved(await window.terminalApi.settings.update({ dismissedUpdateVersion: version }))
    } catch {
      setError('Не удалось сохранить выбор. Обновление доступно в настройках.')
    }
  }
  async function update() {
    if (pending || !status) return
    setPending(true)
    setError('')
    try {
      if (status.state === 'available') {
        installWhenReady.current = true
        await window.terminalApi.updates.download()
        if (installWhenReady.current) await window.terminalApi.updates.install()
      } else if (status.state === 'downloaded') await window.terminalApi.updates.install()
      else await window.terminalApi.updates.check()
    } catch {
      setError('Не удалось выполнить обновление. Повторите проверку или откройте настройки.')
    } finally {
      installWhenReady.current = false
      setPending(false)
    }
  }
  const notes = actionable
    ? status?.releaseNotes || ''
    : changelogVersion(changelog, status?.currentVersion)
  const busy =
    pending ||
    status?.state === 'checking' ||
    status?.state === 'downloading' ||
    status?.state === 'installing'
  return (
    <>
      <button
        className={'update-indicator ' + (actionable ? 'has-update' : '')}
        aria-label="Обновления Termlume"
        title={
          status?.state === 'disabled'
            ? status.message
            : actionable
              ? `Доступно обновление ${status?.version}. Нажмите, чтобы открыть.`
              : `Termlume ${status?.currentVersion || ''}. Обновления каждый час.`
        }
        onClick={() => {
          dialogVersion.current = actionable ? status?.version : undefined
          setError('')
          setOpen(true)
        }}
      >
        {actionable ? <Download size={12} /> : <RefreshCw size={12} />}
        <span>
          {displayVersion(status?.currentVersion) || 'Termlume'}
          {actionable ? ' · обновление' : ''}
        </span>
      </button>
      {!open && error && (
        <span className="update-indicator-error" role="status">
          {error}
        </span>
      )}
      {open &&
        createPortal(
          <div
            className="modal-backdrop update-dialog-backdrop"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                void later()
              }
              if (event.key === 'Tab') {
                const controls = Array.from(
                  modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ||
                    [],
                )
                if (!controls.length) return
                if (
                  event.shiftKey &&
                  (document.activeElement === controls[0] ||
                    document.activeElement === modal.current)
                ) {
                  event.preventDefault()
                  controls.at(-1)?.focus()
                } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
                  event.preventDefault()
                  controls[0].focus()
                }
              }
            }}
          >
            <section
              className="modal update-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={actionable ? 'Доступно обновление Termlume' : 'Обновления Termlume'}
              tabIndex={-1}
              ref={modal}
            >
              <button
                className="icon-button update-dialog-close"
                aria-label="Закрыть окно обновления"
                onClick={() => void later()}
              >
                <X size={18} />
              </button>
              <div className="update-dialog-symbol">
                <Sparkles size={30} />
              </div>
              <h2>{actionable ? 'Доступно новое обновление' : 'Обновления Termlume'}</h2>
              <p className="muted">
                {actionable
                  ? `Termlume ${displayVersion(status?.version)}`
                  : `Установлена версия ${displayVersion(status?.currentVersion)}`}
              </p>
              <div className="update-whats-new">
                <h3>Что нового</h3>
                <ReleaseNotes
                  text={
                    notes ||
                    (actionable
                      ? 'Описание изменений не опубликовано для этой версии.'
                      : 'Новых обновлений пока не найдено.')
                  }
                />
              </div>
              {status?.state === 'downloading' && (
                <>
                  <progress
                    aria-label="Загрузка обновления"
                    max={100}
                    value={status.percent || 0}
                  />
                  <p role="status">Загрузка: {Math.floor(status.percent || 0)}%</p>
                </>
              )}
              {status?.state === 'downloaded' && (
                <p role="status">Обновление скачано и готово к установке.</p>
              )}
              {status?.state === 'disabled' && <p className="muted small">{status.message}</p>}
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <button
                className="primary-button"
                disabled={busy || !status || status.state === 'disabled'}
                onClick={() => void update()}
              >
                {status?.state === 'available'
                  ? 'Обновить сейчас'
                  : status?.state === 'downloaded'
                    ? 'Перезапустить и установить'
                    : busy
                      ? 'Пожалуйста, подождите…'
                      : 'Проверить обновления'}
              </button>
              <button className="text-button" onClick={() => void later()}>
                {actionable ? 'Возможно позже' : 'Закрыть'}
              </button>
              {actionable && (
                <small className="muted">
                  Можно обновиться позже в настройках или нажать на индикатор версии.
                </small>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
