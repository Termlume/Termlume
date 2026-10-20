import { useEffect, useState } from 'react'
import { X, Server, KeyRound } from 'lucide-react'
import type { HostProfile, SshIdentity } from '../../../../shared/contracts'
import { hostSchema } from '../../../../shared/schemas'
import { ru } from '../../app/ru'
interface Props {
  profile?: HostProfile
  onSave: (profile: HostProfile, secret?: string) => Promise<void>
  onClose: () => void
  quick?: boolean
  initialProtocol?: HostProfile['protocol']
}
export function HostEditor({ profile, onSave, onClose, quick = false, initialProtocol }: Props) {
  const [protocol, setProtocol] = useState<HostProfile['protocol']>(
    profile?.protocol || initialProtocol || 'ssh',
  )
  const [name, setName] = useState(profile?.name || ''),
    [host, setHost] = useState(profile && profile.protocol !== 'wsl' ? profile.host : ''),
    [port, setPort] = useState(profile && profile.protocol !== 'wsl' ? profile.port : 22)
  const [username, setUsername] = useState(profile?.protocol === 'ssh' ? profile.username : 'root'),
    [auth, setAuth] = useState<'password' | 'key'>(
      profile?.protocol === 'ssh' ? profile.auth : 'password',
    ),
    [keyPath, setKeyPath] = useState(profile?.protocol === 'ssh' ? profile.keyPath || '' : '')
  const [method, setMethod] = useState<SshIdentity['method']>(
    profile?.protocol === 'ssh' ? (profile.auth === 'key' ? 'key' : 'password') : 'password',
  )
  const [identities, setIdentities] = useState<SshIdentity[]>([]),
    [discovered, setDiscovered] = useState<SshIdentity[]>([]),
    [identityId, setIdentityId] = useState(
      profile?.protocol === 'ssh' ? profile.identityId || '' : '',
    )
  const [secret, setSecret] = useState(''),
    [group, setGroup] = useState(profile?.group || ''),
    [favorite, setFavorite] = useState(profile?.favorite || false),
    [color, setColor] = useState(profile?.color || '#cba6f7')
  const [distribution, setDistribution] = useState(
      profile?.protocol === 'wsl' ? profile.distribution : 'Ubuntu',
    ),
    [encoding, setEncoding] = useState<'utf8' | 'windows-1251' | 'cp866'>(
      profile?.protocol === 'telnet' ? profile.encoding : 'utf8',
    )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const api = window.terminalApi?.identities
    if (!api) return
    api
      .list()
      .then(setIdentities)
      .catch(() => {})
    api
      .discoverSsh()
      .then(setDiscovered)
      .catch(() => {})
  }, [])
  useEffect(() => {
    const identity = [...identities, ...discovered].find((item) => item.id === identityId)
    if (!identity) return
    setMethod(identity.method)
    setAuth(identity.method === 'password' ? 'password' : 'key')
    setKeyPath(identity.keyPath || '')
  }, [identityId, identities, discovered])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      let selectedIdentity: SshIdentity | undefined
      if (protocol === 'ssh' && !quick) {
        const existing = [...identities, ...discovered].find((item) => item.id === identityId)
        selectedIdentity = {
          ...existing,
          id: existing?.id || identityId || crypto.randomUUID(),
          name: existing?.name || name || `${username}@${host}`,
          method,
          keyPath: method === 'key' ? keyPath : undefined,
          agentEndpoint: method === 'agent' ? existing?.agentEndpoint : undefined,
          agentFingerprint: method === 'agent' ? existing?.agentFingerprint : undefined,
        }
      }
      const base = {
        id: profile?.id || crypto.randomUUID(),
        name: name || host || distribution,
        group,
        favorite,
        color,
      }
      const value = hostSchema.parse({
        ...base,
        ...(protocol === 'ssh'
          ? {
              protocol,
              host,
              port,
              username,
              auth: method === 'password' ? 'password' : 'key',
              identityId: selectedIdentity?.id,
              keyPath: method === 'key' ? keyPath : undefined,
              secretRef:
                profile?.protocol === 'ssh' && profile.auth === auth
                  ? profile.secretRef
                  : undefined,
              monitoringEnabled: true,
            }
          : protocol === 'telnet'
            ? { protocol, host, port, encoding }
            : { protocol, distribution }),
      })
      if (protocol === 'ssh' && method === 'key' && !keyPath.trim())
        throw new Error('Укажите путь к приватному ключу')
      if (protocol === 'ssh' && method === 'agent' && !selectedIdentity?.agentEndpoint)
        throw new Error('Выберите SSH-агент из списка обнаруженных идентичностей')
      if (selectedIdentity && window.terminalApi?.identities)
        await window.terminalApi.identities.save(selectedIdentity)
      await onSave(value, quick && secret ? secret : undefined)
      onClose()
    } catch (error) {
      setError(
        error instanceof Error && error.name === 'ZodError'
          ? 'Проверьте адрес, порт и обязательные поля'
          : String(error),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal host-editor"
        aria-label={quick ? 'Быстрое подключение' : ru.newConnection}
        role="dialog"
        aria-modal="true"
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ПОДКЛЮЧЕНИЕ</span>
            <h2>
              {quick ? 'Быстрое подключение' : profile ? 'Изменить подключение' : ru.newConnection}
            </h2>
          </div>
          <button type="button" className="icon-button" aria-label={ru.close} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="form-row">
          <label>
            Название
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Production"
            />
          </label>
          <label>
            Протокол
            <select
              value={protocol}
              onChange={(event) => {
                const next = event.target.value as HostProfile['protocol']
                setProtocol(next)
                setPort(next === 'telnet' ? 23 : 22)
                setSecret('')
              }}
            >
              <option value="ssh">SSH</option>
              <option value="telnet">Telnet</option>
              <option value="wsl">WSL</option>
            </select>
          </label>
        </div>
        {protocol === 'wsl' ? (
          <label>
            Дистрибутив WSL
            <input
              required
              value={distribution}
              onChange={(event) => setDistribution(event.target.value)}
              placeholder="Ubuntu"
            />
          </label>
        ) : (
          <div className="form-row">
            <label>
              Адрес сервера
              <input
                required
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="IP-адрес или hostname"
              />
            </label>
            <label>
              Порт
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
          </div>
        )}
        {protocol === 'ssh' && (
          <>
            {!quick && (
              <label>
                Сохранённая идентичность
                <select value={identityId} onChange={(event) => setIdentityId(event.target.value)}>
                  <option value="">Создать идентичность</option>
                  {identities.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {identity.name}
                    </option>
                  ))}
                  {discovered.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {identity.name} · обнаружена
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Пользователь
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="auth-selector">
              <button
                type="button"
                className={method === 'password' ? 'selected' : ''}
                onClick={() => {
                  setAuth('password')
                  setMethod('password')
                  setIdentityId('')
                  setSecret('')
                }}
              >
                <Server size={14} />
                Пароль
              </button>
              <button
                type="button"
                className={method === 'key' ? 'selected' : ''}
                onClick={() => {
                  setAuth('key')
                  setMethod('key')
                  setIdentityId('')
                  setSecret('')
                }}
              >
                <KeyRound size={14} />
                SSH-ключ
              </button>
              {!quick && (
                <button
                  type="button"
                  className={method === 'agent' ? 'selected' : ''}
                  onClick={() => {
                    setAuth('key')
                    setMethod('agent')
                    setIdentityId('')
                    setSecret('')
                  }}
                >
                  <KeyRound size={14} /> SSH-агент
                </button>
              )}
            </div>
            {method === 'key' && (
              <label>
                Приватный ключ
                <div className="key-path-row">
                  <input
                    required
                    value={keyPath}
                    onChange={(event) => setKeyPath(event.target.value)}
                    placeholder="C:\\Users\\...\\.ssh\\id_ed25519"
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      window.terminalApi?.identities
                        ?.chooseKey()
                        .then((path) => path && setKeyPath(path))
                        .catch((error) => setError(String(error)))
                    }
                  >
                    Обзор…
                  </button>
                </div>
              </label>
            )}
            {quick && method !== 'agent' && (
              <label>
                {auth === 'key' ? 'Passphrase' : 'Пароль'}
                <input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Будет запрошен при подключении"
                />
              </label>
            )}
          </>
        )}
        {protocol === 'telnet' && (
          <label>
            Кодировка
            <select
              value={encoding}
              onChange={(event) => setEncoding(event.target.value as typeof encoding)}
            >
              <option value="utf8">UTF-8</option>
              <option value="windows-1251">Windows-1251</option>
              <option value="cp866">CP866</option>
            </select>
          </label>
        )}
        {!quick && (
          <>
            <div className="form-row">
              <label>
                Группа
                <input
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  placeholder="Без группы"
                />
              </label>
              <label>
                Цветовая метка
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(event) => setFavorite(event.target.checked)}
              />
              Избранное
            </label>
          </>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            {ru.cancel}
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? 'Подождите…' : quick ? 'Подключиться' : ru.save}
          </button>
        </div>
      </form>
    </div>
  )
}
