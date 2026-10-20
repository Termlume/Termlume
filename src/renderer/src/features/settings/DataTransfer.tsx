import { useState } from 'react'

export function DataTransfer() {
  const [passphrase, setPassphrase] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [preview, setPreview] =
      useState<Awaited<ReturnType<typeof window.terminalApi.data.previewImport>>>(),
    [strategy, setStrategy] = useState<'merge' | 'replace'>('merge'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  async function exportData() {
    setError('')
    setNotice('')
    if (passphrase.length < 8)
      return setError('Пароль резервной копии должен содержать не менее 8 символов.')
    if (passphrase !== confirmation) return setError('Пароли не совпадают.')
    setBusy(true)
    try {
      await window.terminalApi.data.export(passphrase)
      setNotice('Резервная копия сохранена.')
      setPassphrase('')
      setConfirmation('')
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  async function previewImport() {
    setError('')
    setNotice('')
    if (passphrase.length < 8) return setError('Введите пароль резервной копии.')
    setBusy(true)
    try {
      setPreview(await window.terminalApi.data.previewImport(passphrase))
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  async function commitImport() {
    if (!preview) return
    setError('')
    setBusy(true)
    try {
      await window.terminalApi.data.commitImport(preview.token, strategy)
      setNotice('Данные импортированы. Перезапустите приложение, чтобы применить все настройки.')
      setPreview(undefined)
      setPassphrase('')
      setConfirmation('')
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="data-transfer">
      <div className="setting-title">
        <strong>Резервная копия и перенос данных</strong>
      </div>
      <p className="muted small">
        Экспорт включает подключения, избранное, настройки, доверенные серверы и защищённые пароли.
        Секреты шифруются выбранным паролем. Содержимое приватных SSH-ключей не копируется; ссылки
        на файлы ключей остаются локальными.
      </p>
      <div className="form-row">
        <label>
          Пароль архива
          <input
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <label>
          Подтвердите пароль для экспорта
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      </div>
      <div className="data-transfer-actions">
        <button className="secondary-button" disabled={busy} onClick={() => void exportData()}>
          Сохранить архив
        </button>
        <button className="secondary-button" disabled={busy} onClick={() => void previewImport()}>
          Открыть архив
        </button>
      </div>
      {preview && (
        <div className="import-preview">
          <strong>
            Будет импортировано: {preview.hosts} подключений, {preview.identities}{' '}
            SSH-идентификаций.
          </strong>
          <span>
            Совпадения ID: {preview.conflicts.hosts} подключений, {preview.conflicts.identities}{' '}
            идентификаций, {preview.conflicts.knownHosts} ключей серверов.
          </span>
          <label>
            Обработка данных
            <select
              aria-label="Стратегия импорта"
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as 'merge' | 'replace')}
            >
              <option value="merge">Объединить, обновляя совпадающие записи</option>
              <option value="replace">Заменить текущие данные архивом</option>
            </select>
          </label>
          <button className="primary-button" disabled={busy} onClick={() => void commitImport()}>
            Подтвердить импорт
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="muted small">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  )
}
