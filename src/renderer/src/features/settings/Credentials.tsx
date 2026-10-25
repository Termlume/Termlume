import { useEffect, useRef, useState } from 'react'
import { ArrowRight, KeyRound, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import type { HostProfile, SshIdentity } from '../../../../shared/contracts'
import './credentials.css'
const methodName = (method: SshIdentity['method']) =>
  method === 'password' ? 'Пароль' : method === 'key' ? 'SSH-ключ' : 'SSH-агент'
export function Credentials({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [items, setItems] = useState<SshIdentity[]>([]),
    [hosts, setHosts] = useState<HostProfile[]>([])
  const [editing, setEditing] = useState<SshIdentity>(),
    [secret, setSecret] = useState('')
  const [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'replace' | 'delete'>(),
    [replacement, setReplacement] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const original = items.find((item) => item.id === editing?.id)
  const dirty = !!editing && (!!secret || JSON.stringify(editing) !== JSON.stringify(original))
  const dirtyHandler = useRef(onDirtyChange)
  dirtyHandler.current = onDirtyChange
  useEffect(() => {
    dirtyHandler.current?.(dirty)
  }, [dirty])
  useEffect(
    () => () => {
      dirtyHandler.current?.(false)
    },
    [],
  )
  const linked = (id: string) =>
    hosts.filter((host) => 'identityId' in host && host.identityId === id)
  const affected = editing ? linked(editing.id) : []
  const filtered = items.filter((item) =>
    `${item.name} ${item.username || ''} ${linked(item.id)
      .map((host) => ('username' in host ? host.username : ''))
      .join(' ')}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )
  async function refresh(selectId?: string) {
    const [credentials, profiles] = await Promise.all([
      window.terminalApi.identities.list(),
      window.terminalApi.hosts.list(),
    ])
    setItems(credentials)
    setHosts(profiles)
    setEditing(credentials.find((item) => item.id === selectId) || credentials[0])
  }
  useEffect(() => {
    refresh()
      .catch((error) => setError(String(error)))
      .finally(() => setLoading(false))
  }, [])
  function select(item: SshIdentity) {
    if (dirty) {
      setError('Сохраните изменения или нажмите «Отменить изменения» перед выбором другой записи.')
      return
    }
    setEditing({ ...item })
    setSecret('')
    setOperation(undefined)
    setError('')
    setNotice('')
  }
  function startOperation(next: 'replace' | 'delete') {
    setOperation(next)
    setReplacement('')
    setConfirmed(false)
    setError('')
    setNotice('')
  }
  async function save() {
    if (!editing) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const saved = await window.terminalApi.identities.save(editing, secret || undefined)
      setSecret('')
      await refresh(saved.id)
      setNotice('Учётные данные сохранены. Изменения применятся при следующем подключении.')
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!editing || !confirmed || (operation === 'replace' && !replacement)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await window.terminalApi.identities.remove(
        editing.id,
        operation === 'replace'
          ? { replacementId: replacement, confirmMerge: true }
          : { detach: true },
      )
      setSecret('')
      setOperation(undefined)
      await refresh(operation === 'replace' ? replacement : undefined)
      setNotice(
        operation === 'replace'
          ? 'Данные заменены у серверов. Изменения применятся при следующем подключении.'
          : 'Запись удалена. Серверы сохранили собственные данные для входа.',
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="credentials-manager"
      aria-label="Управление учётными данными"
      aria-busy={busy || loading}
    >
      <header className="credentials-heading">
        <div>
          <h3>Учётные данные</h3>
          <p className="muted small">Один логин и секрет для нескольких серверов.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || loading}
          onClick={() =>
            select({ id: crypto.randomUUID(), name: '', username: '', method: 'password' })
          }
        >
          <Plus size={15} />
          Добавить
        </button>
      </header>
      <div className="credentials-layout">
        <aside className="credentials-sidebar">
          <label className="credentials-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Найти учётные данные"
              placeholder="Название или логин"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="credentials-list" aria-label="Сохранённые учётные данные">
            {filtered.map((item) => (
              <button
                type="button"
                className={'credential-row' + (editing?.id === item.id ? ' selected' : '')}
                key={item.id}
                disabled={busy}
                aria-pressed={editing?.id === item.id}
                onClick={() => select(item)}
              >
                <KeyRound size={16} aria-hidden="true" />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.username || 'Логин из профиля'}</small>
                  <small>
                    {methodName(item.method)} · Серверов: {linked(item.id).length}
                  </small>
                </span>
              </button>
            ))}
            {loading ? (
              <p className="credentials-empty" role="status">
                Загрузка…
              </p>
            ) : (
              !filtered.length && (
                <p className="credentials-empty">
                  {items.length ? 'Ничего не найдено' : 'Пока нет сохранённых записей'}
                </p>
              )
            )}
          </nav>
          <p className="credentials-security">
            <ShieldCheck size={14} aria-hidden="true" />
            Секреты защищены системным хранилищем
          </p>
        </aside>
        <div className="credentials-detail">
          {!editing ? (
            <div className="credentials-placeholder">
              <KeyRound size={28} />
              <h4>Сохраните данные для входа</h4>
              <p className="muted small">
                Добавьте запись, затем выберите её в настройках нужных серверов.
              </p>
            </div>
          ) : (
            <>
              <div className="credentials-detail-heading">
                <div>
                  <span className="eyebrow">
                    {original ? 'СОХРАНЁННАЯ ЗАПИСЬ' : 'НОВАЯ ЗАПИСЬ'}
                  </span>
                  <h4>{original?.name || 'Новые учётные данные'}</h4>
                </div>
                {dirty && !operation && <span className="credentials-draft">Не сохранено</span>}
              </div>
              {!operation ? (
                <>
                  <div className="credentials-fields">
                    <label>
                      Название компании или произвольное имя
                      <input
                        maxLength={150}
                        disabled={busy}
                        value={editing.name}
                        placeholder="Например, Компания · Production"
                        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                      />
                    </label>
                    <div className="credentials-field-pair">
                      <label>
                        Логин
                        <input
                          maxLength={100}
                          disabled={busy}
                          value={editing.username || ''}
                          autoComplete="off"
                          onChange={(event) =>
                            setEditing({ ...editing, username: event.target.value || undefined })
                          }
                        />
                      </label>
                      <label>
                        Способ входа
                        <select
                          disabled={busy}
                          value={editing.method}
                          onChange={(event) => {
                            setEditing({
                              ...editing,
                              method: event.target.value as SshIdentity['method'],
                            })
                            setSecret('')
                          }}
                        >
                          <option value="password">Пароль</option>
                          <option value="key">SSH-ключ</option>
                          {original?.method === 'agent' && <option value="agent">SSH-агент</option>}
                        </select>
                      </label>
                    </div>
                    {!editing.username && (
                      <p className="muted small credentials-helper">
                        {original
                          ? 'В старой записи логин хранится отдельно в каждом профиле. Пустое поле сохранит это поведение; новый логин станет общим для всех связанных серверов.'
                          : 'Укажите общий логин для серверов, которые будут использовать эту запись.'}
                      </p>
                    )}
                    {editing.method === 'key' && (
                      <label>
                        Путь к приватному ключу
                        <div className="credentials-key-path">
                          <input
                            disabled={busy}
                            value={editing.keyPath || ''}
                            placeholder={
                              window.terminalApi.platform === 'linux'
                                ? '~/.ssh/id_ed25519'
                                : 'C:\\Users\\...\\.ssh\\id_ed25519'
                            }
                            onChange={(event) =>
                              setEditing({ ...editing, keyPath: event.target.value })
                            }
                          />
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              window.terminalApi.identities
                                .chooseKey()
                                .then((path) => path && setEditing({ ...editing, keyPath: path }))
                                .catch((error) => setError(String(error)))
                            }
                          >
                            Обзор…
                          </button>
                        </div>
                      </label>
                    )}
                    {editing.method !== 'agent' && (
                      <label>
                        {editing.method === 'key' ? 'Новая passphrase' : 'Новый пароль'}
                        <input
                          type="password"
                          disabled={busy}
                          autoComplete="new-password"
                          value={secret}
                          onChange={(event) => setSecret(event.target.value)}
                          placeholder={
                            original
                              ? 'Пусто — оставить сохранённый секрет'
                              : 'Можно ввести при первом подключении'
                          }
                        />
                        <small className="muted">Сохранённый секрет никогда не показывается.</small>
                      </label>
                    )}
                  </div>
                  <div className="credentials-linked">
                    <strong>
                      Связанные серверы <span>{affected.length}</span>
                    </strong>
                    {affected.length ? (
                      <ul>
                        {affected.map((host) => (
                          <li key={host.id}>
                            <span>{host.name}</span>
                            <small>
                              {'username' in host ? editing.username || host.username : ''}
                              {'host' in host ? ` @ ${host.host}` : ''}
                            </small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">
                        Выберите эту запись в поле «Учётные данные» нужного сервера.
                      </p>
                    )}
                  </div>
                  <p className="credentials-impact muted small">
                    Логин, пароль и ключ общие для всех связанных серверов. Изменения применятся при
                    следующем подключении.
                  </p>
                  <div className="credentials-save-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        busy ||
                        !dirty ||
                        !editing.name.trim() ||
                        (!editing.username?.trim() && (!original || !!original.username)) ||
                        (editing.method === 'key' && !editing.keyPath?.trim())
                      }
                      onClick={save}
                    >
                      {busy ? 'Сохранение…' : 'Сохранить учётные данные'}
                    </button>
                    {dirty && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(original ? { ...original } : items[0])
                          setSecret('')
                          setError('')
                        }}
                      >
                        Отменить изменения
                      </button>
                    )}
                  </div>
                  {original && (
                    <div className="credentials-other-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy || dirty || items.length < 2 || !affected.length}
                        onClick={() => startOperation('replace')}
                      >
                        <ArrowRight size={14} />
                        Заменить у серверов…
                      </button>
                      <button
                        type="button"
                        className="text-button credentials-delete"
                        disabled={busy || dirty}
                        onClick={() => startOperation('delete')}
                      >
                        <Trash2 size={14} />
                        Удалить запись…
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="credentials-operation">
                  <h4>
                    {operation === 'replace'
                      ? 'Заменить данные у серверов'
                      : 'Удалить сохранённую запись'}
                  </h4>
                  <p className="muted small">
                    {operation === 'replace'
                      ? 'Выберите другую запись. Связанные серверы получат её логин и секрет при следующем подключении. Текущая запись будет удалена из списка; выбранная запись сохранится.'
                      : 'Связанные серверы будут отвязаны от общей записи. Их текущие логины, пароли и ключи сохранятся как собственные данные каждого профиля. Действующие подключения продолжат работу.'}
                  </p>
                  <div className="credentials-linked">
                    <strong>
                      Затронутые серверы <span>{affected.length}</span>
                    </strong>
                    {affected.length ? (
                      <ul>
                        {affected.map((host) => (
                          <li key={host.id}>{host.name}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">Связанных серверов нет.</p>
                    )}
                  </div>
                  {operation === 'replace' && (
                    <label>
                      Новые учётные данные
                      <select
                        disabled={busy}
                        value={replacement}
                        onChange={(event) => {
                          setReplacement(event.target.value)
                          setConfirmed(false)
                        }}
                      >
                        <option value="">Выберите запись</option>
                        {items
                          .filter((item) => item.id !== editing.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.username || 'Логин из профиля'} ·{' '}
                              {methodName(item.method)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className="credentials-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || (operation === 'replace' && !replacement)}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      {operation === 'replace'
                        ? 'Подтверждаю замену у перечисленных серверов и удаление текущей записи.'
                        : 'Удалить общую запись, сохранив собственные данные для входа у серверов.'}
                    </span>
                  </label>
                  <div className="credentials-save-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || !confirmed || (operation === 'replace' && !replacement)}
                      onClick={remove}
                    >
                      {busy
                        ? 'Применение…'
                        : operation === 'replace'
                          ? 'Подтвердить замену'
                          : 'Удалить и сохранить вход'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setOperation(undefined)
                        setError('')
                      }}
                    >
                      Назад
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="credentials-notice" role="status">
          <ShieldCheck size={15} />
          {notice}
        </p>
      )}
    </section>
  )
}
