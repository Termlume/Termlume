import { useEffect, useRef, useState } from 'react'
import { HighlightRulesEditor } from '../settings/HighlightRulesEditor'
import { WslDistributionSelect } from './WslDistributionSelect'
import type { HighlightRule } from '../../../../shared/highlight-rules'
import { X, Server, KeyRound, Info } from 'lucide-react'
import type { HostProfile, SshIdentity } from '../../../../shared/contracts'
import { hostSchema } from '../../../../shared/schemas'
import './hosts.css'
import { ru } from '../../app/ru'
interface Props {
  profile?: HostProfile
  onSave: (profile: HostProfile, secret?: string) => Promise<void>
  onClose: () => void
  quick?: boolean
  initialProtocol?: HostProfile['protocol']
}
export function HostEditor({ profile, onSave, onClose, quick = false, initialProtocol }: Props) {
  const usernameEdited = useRef(false)
  const [protocol, setProtocol] = useState<HostProfile['protocol']>(
    profile?.protocol || initialProtocol || 'ssh',
  )
  const [name, setName] = useState(profile?.name || ''),
    [host, setHost] = useState(profile && profile.protocol !== 'wsl' ? profile.host : ''),
    [port, setPort] = useState(profile && profile.protocol !== 'wsl' ? profile.port : 22)
  const [username, setUsername] = useState(
      profile &&
        (profile.protocol === 'ssh' || profile.protocol === 'sftp' || profile.protocol === 'ftp')
        ? profile.username
        : 'root',
    ),
    [auth, setAuth] = useState<'password' | 'key'>(
      profile?.protocol === 'ssh' || profile?.protocol === 'sftp' ? profile.auth : 'password',
    ),
    [keyPath, setKeyPath] = useState(
      profile?.protocol === 'ssh' || profile?.protocol === 'sftp' ? profile.keyPath || '' : '',
    )
  const [method, setMethod] = useState<SshIdentity['method']>(
    profile?.protocol === 'ssh' || profile?.protocol === 'sftp'
      ? profile.agentEndpoint
        ? 'agent'
        : profile.auth === 'key'
          ? 'key'
          : 'password'
      : 'password',
  )
  const [identities, setIdentities] = useState<SshIdentity[]>([]),
    [discovered, setDiscovered] = useState<SshIdentity[]>([]),
    [identityId, setIdentityId] = useState(
      profile?.protocol === 'ssh' || profile?.protocol === 'sftp' ? profile.identityId || '' : '',
    )
  const [ftpSecurity, setFtpSecurity] = useState<'none' | 'explicit-tls' | 'implicit-tls'>(
    profile?.protocol === 'ftp' ? profile.security : 'explicit-tls',
  )
  const [tagsInput, setTagsInput] = useState((profile?.tags || []).join(', '))
  const [x11Forwarding, setX11Forwarding] = useState(
    profile?.protocol === 'ssh' && !!profile.x11Forwarding,
  )
  const [highlightRules, setHighlightRules] = useState<HighlightRule[] | undefined>(
    profile?.highlightRules,
  )
  const [secret, setSecret] = useState(''),
    [group, setGroup] = useState(profile?.group || ''),
    [favorite, setFavorite] = useState(profile?.favorite || false),
    [color, setColor] = useState(profile?.color || '#cba6f7')
  const [distribution, setDistribution] = useState(
      profile?.protocol === 'wsl' ? profile.distribution : '',
    ),
    [encoding, setEncoding] = useState<'utf8' | 'windows-1251' | 'cp866'>(
      profile?.protocol === 'telnet' ? profile.encoding : 'utf8',
    )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (profile || !window.terminalApi?.settings?.get) return
    let active = true
    window.terminalApi.settings
      .get()
      .then((settings) => {
        if (active && !usernameEdited.current && settings.lastUsername)
          setUsername(settings.lastUsername)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
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
    if (identity.username) {
      usernameEdited.current = true
      setUsername(identity.username)
    }
    setSecret('')
  }, [identityId, identities, discovered])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      let selectedIdentity: SshIdentity | undefined
      if ((protocol === 'ssh' || protocol === 'sftp') && !quick && identityId) {
        const existing = [...identities, ...discovered].find((item) => item.id === identityId)
        selectedIdentity = {
          ...existing,
          id: existing?.id || identityId,
          name: existing?.name || name || `${username}@${host}`,
          method,
          keyPath: method === 'key' ? keyPath : undefined,
          agentEndpoint: method === 'agent' ? existing?.agentEndpoint : undefined,
          agentFingerprint: method === 'agent' ? existing?.agentFingerprint : undefined,
        }
      }
      const base = {
        highlightRules,
        monitoringItems: profile?.monitoringItems,
        id: profile?.id || crypto.randomUUID(),
        name: name || host || distribution,
        group,
        tags: tagsInput
          .split(/[,;\s]+/)
          .map((tag) => tag.trim().replace(/^#+/, ''))
          .filter(Boolean),
        favorite,
        color,
      }
      const value = hostSchema.parse({
        ...base,
        ...(protocol === 'ssh' || protocol === 'sftp'
          ? {
              protocol,
              host,
              port,
              username: selectedIdentity?.username || username,
              auth: method === 'password' ? 'password' : 'key',
              identityId: selectedIdentity?.id,
              agentEndpoint:
                !selectedIdentity &&
                method === 'agent' &&
                (profile?.protocol === 'ssh' || profile?.protocol === 'sftp')
                  ? profile.agentEndpoint
                  : undefined,
              agentFingerprint:
                !selectedIdentity &&
                method === 'agent' &&
                (profile?.protocol === 'ssh' || profile?.protocol === 'sftp')
                  ? profile.agentFingerprint
                  : undefined,
              keyPath: method === 'key' ? keyPath : undefined,
              secretRef:
                !selectedIdentity &&
                (profile?.protocol === 'ssh' || profile?.protocol === 'sftp') &&
                profile.auth === auth
                  ? profile.secretRef
                  : undefined,
              monitoringEnabled: true,
              x11Forwarding: protocol === 'ssh' ? x11Forwarding : undefined,
            }
          : protocol === 'ftp'
            ? {
                protocol,
                host,
                port,
                username,
                security: ftpSecurity,
                secretRef: profile?.protocol === 'ftp' ? profile.secretRef : undefined,
              }
            : protocol === 'telnet'
              ? { protocol, host, port, encoding }
              : { protocol, distribution }),
      })
      if ((protocol === 'ssh' || protocol === 'sftp') && method === 'key' && !keyPath.trim())
        throw new Error('Укажите путь к приватному ключу')
      if (
        (protocol === 'ssh' || protocol === 'sftp') &&
        method === 'agent' &&
        !selectedIdentity?.agentEndpoint &&
        !((profile?.protocol === 'ssh' || profile?.protocol === 'sftp') && profile.agentEndpoint)
      )
        throw new Error('Выберите SSH-агент из списка обнаруженных идентичностей')
      if (
        selectedIdentity &&
        discovered.some((item) => item.id === selectedIdentity.id) &&
        window.terminalApi?.identities
      )
        await window.terminalApi.identities.save(selectedIdentity)
      await onSave(value, !selectedIdentity && secret ? secret : undefined)
      if (!quick && !selectedIdentity && secret)
        await window.terminalApi.hosts.setSecret(value.id, secret)
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
                setPort(
                  next === 'telnet'
                    ? 23
                    : next === 'ftp'
                      ? ftpSecurity === 'implicit-tls'
                        ? 990
                        : 21
                      : 22,
                )
                setSecret('')
              }}
            >
              <option value="ssh">SSH</option>
              <option value="sftp">SFTP — файловый клиент</option>
              <option value="ftp">FTP / FTPS — файловый клиент</option>
              <option value="telnet">Telnet</option>
              {window.terminalApi.platform !== 'linux' && <option value="wsl">WSL</option>}
            </select>
          </label>
        </div>
        {protocol === 'wsl' ? (
          <WslDistributionSelect value={distribution} onChange={setDistribution} />
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
        {(protocol === 'ssh' || protocol === 'sftp') && (
          <>
            {!quick && (
              <label>
                Учётные данные
                <select
                  value={identityId}
                  onChange={(event) => {
                    setIdentityId(event.target.value)
                    setSecret('')
                  }}
                >
                  <option value="">Собственные для этого подключения</option>
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
                disabled={
                  !!identityId &&
                  identities.some((item) => item.id === identityId && !!item.username)
                }
                value={username}
                onChange={(event) => {
                  usernameEdited.current = true
                  setUsername(event.target.value)
                }}
                autoComplete="off"
              />
            </label>
            {identityId && (
              <p className="muted small">
                Общие данные меняются в настройках → Учётные данные. Изменения применяются ко всем
                связанным подключениям.
              </p>
            )}
            {!identityId && (
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
            )}
            {method === 'key' && (
              <label>
                Приватный ключ
                <div className="key-path-row">
                  <input
                    required
                    disabled={!!identityId}
                    value={keyPath}
                    onChange={(event) => setKeyPath(event.target.value)}
                    placeholder={
                      window.terminalApi.platform === 'linux'
                        ? '~/.ssh/id_ed25519'
                        : 'C:\\Users\\...\\.ssh\\id_ed25519'
                    }
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!!identityId}
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
            {!identityId && method !== 'agent' && (
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
        {protocol === 'ssh' && (
          <div className="host-x11-option">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={x11Forwarding}
                onChange={(event) => setX11Forwarding(event.target.checked)}
              />
              Графические приложения X11
            </label>
            <details className="host-x11-help">
              <summary aria-label="О перенаправлении X11">
                <Info size={14} aria-hidden="true" />
              </summary>
              <p>
                Окна приложений с сервера появятся на этом компьютере. На сервере нужны xauth и
                X11Forwarding yes. Включайте для доверенных серверов.
              </p>
            </details>
          </div>
        )}
        {protocol === 'ftp' && (
          <>
            <label>
              Защита соединения
              <select
                value={ftpSecurity}
                onChange={(event) => {
                  const next = event.target.value as typeof ftpSecurity
                  setFtpSecurity(next)
                  if (port === 21 || port === 990) setPort(next === 'implicit-tls' ? 990 : 21)
                }}
              >
                <option value="explicit-tls">FTPS — явный TLS</option>
                <option value="implicit-tls">FTPS — неявный TLS</option>
                <option value="none">FTP — без шифрования</option>
              </select>
            </label>
            <label>
              Пользователь
              <input
                required
                value={username}
                onChange={(event) => {
                  usernameEdited.current = true
                  setUsername(event.target.value)
                }}
                autoComplete="off"
              />
            </label>
            {quick && (
              <label>
                Пароль
                <input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Будет запрошен при подключении"
                />
              </label>
            )}
            {!quick && (
              <p className="muted">
                Пароль будет запрошен при подключении и сохранён в системном хранилище секретов
                после успешного входа.
              </p>
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
            <label>
              Теги
              <input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder="prod, database"
              />
              <small>Через запятую или пробел</small>
            </label>
            <div className="host-editor-tags">
              {Array.from(
                new Set(
                  tagsInput
                    .split(/[,;\s]+/)
                    .map((tag) => tag.trim().replace(/^#+/, ''))
                    .filter(Boolean),
                ),
              ).map((tag) => (
                <span className="host-tag" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(event) => setFavorite(event.target.checked)}
              />
              Избранное
            </label>
            {(protocol === 'ssh' || protocol === 'telnet' || protocol === 'wsl') && (
              <HighlightRulesEditor inherited value={highlightRules} onChange={setHighlightRules} />
            )}
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
