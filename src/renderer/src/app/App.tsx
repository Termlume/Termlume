import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { X, Columns2 } from 'lucide-react'
import { Shell } from './Shell'
import { Sidebar } from './Sidebar'
import { Workspace } from './Workspace'
import { UpdateNotice } from '../features/settings/UpdateNotice'
import { Appearance } from '../features/settings/Appearance'
import { applyTheme } from '../themes/apply-theme'
import type { HostProfile, Settings } from '../../../shared/contracts'
import { useHosts, filterHosts } from '../features/hosts/useHosts'
import { HostList } from '../features/hosts/HostList'
import { orderedGroups, moveGroup } from '../features/hosts/group-order'
import { HostEditor } from '../features/hosts/HostEditor'
import { QuickConnect } from '../features/hosts/QuickConnect'
import { useSessions } from '../features/sessions/useSessions'
import { Tabs, stateLabels } from '../features/sessions/Tabs'
import { TerminalView } from '../features/terminal/TerminalView'
import { AuthDialog } from '../features/sessions/AuthDialog'
import { HostKeyDialog } from '../features/sessions/HostKeyDialog'
import { SftpBrowser } from '../features/sftp/Browser'
import { FileWorkspace } from '../features/sftp/FileWorkspace'
import { enqueueSelection } from '../features/sftp/enqueue-selection'
import { Transfers } from '../features/sftp/Transfers'
import { MonitoringPanel } from '../features/monitoring/MonitoringPanel'
import { ru } from './ru'
import './styles.css'
import { ResizeHandle } from './ResizeHandle'
import { SplitWorkspace } from '../features/workspace/SplitWorkspace'
import { routeShortcut, shortcutKeys } from './keyboard-shortcuts'
import type { LayoutPreset } from '../features/workspace/workspace-layout'
import { KeyboardShortcutsDialog } from '../features/settings/KeyboardShortcutsDialog'
import { CommandPalette } from '../features/commands/CommandPalette'
applyTheme('catppuccin-mocha')
export default function App() {
  const [settings, setSettings] = useState<Settings>(),
    [appearance, setAppearance] = useState(false),
    [updateDialogOpen, setUpdateDialogOpen] = useState(false),
    [files, setFiles] = useState(false),
    [monitor, setMonitor] = useState(false),
    [localFilesVisible, setLocalFilesVisible] = useState<boolean>(),
    [error, setError] = useState('')
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const bottomMonitoring = settings?.monitoringPlacement === 'under-terminal'
  const sharedDocks = viewportWidth <= 1250 && files && monitor && !bottomMonitoring
  const compactMax = Math.max(
    280,
    Math.min(450, viewportWidth - (settings?.sidebarWidth || 260) - 56 - 260),
  )
  const fileWidth = sharedDocks
    ? Math.min(settings?.sftpWidth || 380, compactMax)
    : settings?.sftpWidth || 380
  const catalog = useHosts(setError)
  const sessions = useSessions(setError)
  const shortcutHandler = useRef<(event: KeyboardEvent, target?: EventTarget | null) => void>(
    () => {},
  )
  const [quick, setQuick] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [layoutPreset, setLayoutPreset] = useState<{ revision: number; preset: LayoutPreset }>()
  const [fileRevision, setFileRevision] = useState(0)
  const activeTab = sessions.tabs.find((tab) => tab.id === sessions.active)
  const fileTabActive =
    activeTab?.profile.protocol === 'sftp' || activeTab?.profile.protocol === 'ftp'
  const terminalTabs = sessions.tabs.filter(
    (tab) => tab.profile.protocol !== 'sftp' && tab.profile.protocol !== 'ftp',
  )
  const activeHost = activeTab?.profile.protocol === 'local' ? undefined : activeTab?.profile
  const challenge = sessions.challenges[0]
  const answerChallenge = async (
    answer: Parameters<typeof window.terminalApi.sessions.answer>[1],
  ) => {
    if (!challenge) return
    await window.terminalApi.sessions.answer(challenge.challenge.id, answer)
    sessions.setChallenges((current) =>
      current.filter((item) => item.challenge.id !== challenge.challenge.id),
    )
  }
  const [editor, setEditor] = useState<HostProfile | null | undefined>(undefined),
    [search, setSearch] = useState(''),
    [favoriteOnly, setFavoriteOnly] = useState(false),
    [initialProtocol, setInitialProtocol] = useState<HostProfile['protocol']>('ssh'),
    [removeHost, setRemoveHost] = useState<HostProfile>()
  const newHost = () => {
    setInitialProtocol('ssh')
    setEditor(null)
  }
  const openHost = (profile: HostProfile) => {
    if (profile.protocol === 'ssh') setMonitor(true)
    void sessions.open(profile)
  }
  const savePreference = (patch: Partial<Settings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void window.terminalApi.settings.update(patch).catch((error) => setError(String(error)))
  }
  const openSettings = () => {
    setAppearance(true)
  }
  shortcutHandler.current = (event, target = event.target) => {
    if (event.repeat) return
    const formFieldTarget =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        (target.matches('input, textarea, select, [role="textbox"]') &&
          !target.classList.contains('xterm-helper-textarea')))
    const action = routeShortcut(
      event,
      {
        hasActiveTab: Boolean(sessions.active),
        tabCount: sessions.tabs.length,
        modalOpen:
          updateDialogOpen ||
          commandsOpen ||
          quick ||
          shortcutsOpen ||
          appearance ||
          Boolean(challenge) ||
          editor !== undefined ||
          Boolean(removeHost),
        formFieldTarget,
      },
      settings?.shortcutBindings,
    )
    if (!action) return
    event.preventDefault()
    if (action === 'commands') {
      setCommandsOpen(true)
    } else if (action === 'close-active' && sessions.active) {
      void sessions.close(sessions.active).catch((error) => setError(String(error)))
    } else if (action === 'next-tab' || action === 'previous-tab') {
      const index = sessions.tabs.findIndex((tab) => tab.id === sessions.active)
      const direction = action === 'next-tab' ? 1 : -1
      const next = (index + direction + sessions.tabs.length) % sessions.tabs.length
      sessions.setActive(sessions.tabs[next]?.id)
    } else if (action === 'new-connection') {
      setQuick(true)
    } else if (action === 'new-local') {
      void sessions.openLocal(settings?.localShell || 'powershell')
    } else if (typeof action === 'object') {
      setLayoutPreset((current) => ({
        revision: (current?.revision || 0) + 1,
        preset: action.preset,
      }))
    }
  }
  useEffect(() => {
    window.terminalApi.settings
      .get()
      .then((value) => {
        setSettings(value)
        applyTheme(value.themeId)
        document.documentElement.style.setProperty('--sidebar-width', value.sidebarWidth + 'px')
      })
      .catch((error) => setError(String(error)))
  }, [])
  useEffect(() => window.terminalApi.app.onNotice(setError), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent, target?: EventTarget | null) =>
      shortcutHandler.current(event, target)
    window.addEventListener('keydown', onKeyDown)
    const removeMainShortcut = window.terminalApi.app.onShortcut((shortcut) => {
      const relayed = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: shortcut.key,
        ctrlKey: shortcut.ctrlKey,
        shiftKey: shortcut.shiftKey,
        altKey: shortcut.altKey,
      })
      if (document.activeElement?.closest('.keyboard-shortcuts-dialog'))
        document.activeElement.dispatchEvent(relayed)
      else onKeyDown(relayed, document.activeElement)
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      removeMainShortcut()
    }
  }, [])
  return (
    <>
      <Shell
        commandsShortcut={shortcutKeys('commands', settings?.shortcutBindings)}
        onCommands={() => setCommandsOpen(true)}
        tabs={
          <Tabs
            shortcutBindings={settings?.shortcutBindings}
            tabs={sessions.tabs}
            active={sessions.active}
            onSelect={sessions.setActive}
            onClose={(id) => {
              sessions.close(id).catch((error) => setError(String(error)))
            }}
            onNew={() => setQuick(true)}
            favorites={catalog.hosts.filter((host) => host.favorite)}
            onOpenHost={openHost}
            onOpenLocal={(shell) => void sessions.openLocal(shell)}
            defaultLocalShell={settings?.localShell}
          />
        }
        updateIndicator={
          settings && (
            <UpdateNotice
              settings={settings}
              onSaved={setSettings}
              onOpenChange={setUpdateDialogOpen}
            />
          )
        }
        footer={
          activeTab && (
            <span>
              {stateLabels[activeTab.state]} · {activeTab.profile.protocol.toUpperCase()}
            </span>
          )
        }
        sidebar={
          <>
            <Sidebar
              onNew={newHost}
              connectionsCollapsed={settings?.connectionsCollapsed}
              onToggleConnections={() =>
                savePreference({ connectionsCollapsed: !settings?.connectionsCollapsed })
              }
              search={search}
              onSearch={setSearch}
              favoriteOnly={favoriteOnly}
              onFavorite={() => setFavoriteOnly(!favoriteOnly)}
            >
              {catalog.hosts.length > 0 && (
                <HostList
                  hosts={filterHosts(catalog.hosts, search, favoriteOnly)}
                  onConnect={openHost}
                  collapsedGroups={settings?.collapsedHostGroups}
                  groupOrder={settings?.hostGroupOrder}
                  onReorderGroup={(source, target, position) => {
                    const groups = orderedGroups(
                      catalog.hosts.map((host) => host.group || ''),
                      settings?.hostGroupOrder,
                    )
                    savePreference({ hostGroupOrder: moveGroup(groups, source, target, position) })
                  }}
                  searchActive={Boolean(search.trim())}
                  onToggleGroup={(group) => {
                    const current = settings?.collapsedHostGroups || []
                    savePreference({
                      collapsedHostGroups: current.includes(group)
                        ? current.filter((value) => value !== group)
                        : [...current, group],
                    })
                  }}
                  onTag={(tag) =>
                    setSearch(
                      search.trim().toLocaleLowerCase() === `#${tag.toLocaleLowerCase()}`
                        ? ''
                        : `#${tag}`,
                    )
                  }
                  onEdit={setEditor}
                  onRemove={setRemoveHost}
                  onFavorite={(profile) => {
                    catalog
                      .save({ ...profile, favorite: !profile.favorite })
                      .catch((error) => setError(String(error)))
                  }}
                />
              )}
            </Sidebar>
            {settings && (
              <ResizeHandle
                value={settings.sidebarWidth}
                min={200}
                max={500}
                onChange={(sidebarWidth) => {
                  setSettings({ ...settings, sidebarWidth })
                  document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px')
                }}
                onCommit={(sidebarWidth) => {
                  window.terminalApi.settings
                    .update({ sidebarWidth })
                    .catch((error) => setError(String(error)))
                }}
              />
            )}
          </>
        }
        onSettings={openSettings}
        onHome={() => {
          sessions.setActive(undefined)
        }}
        onFiles={() => setFiles(!files)}
        onMonitor={() => setMonitor(!monitor)}
        onHelp={() => setShortcutsOpen(true)}
      >
        <div
          className="main-area"
          style={{ '--compact-dock-width': `${fileWidth}px` } as CSSProperties}
        >
          <div className="main-content">
            {!sessions.active && (
              <Workspace
                onNew={newHost}
                onWsl={() => {
                  window.terminalApi.wsl
                    .list()
                    .then((distributions) => {
                      const distribution =
                        distributions.find((name) => name.startsWith('Ubuntu')) || distributions[0]
                      if (!distribution)
                        throw new Error('Не найдено установленных дистрибутивов WSL')
                      return sessions.open(
                        {
                          id: crypto.randomUUID(),
                          name: distribution,
                          protocol: 'wsl',
                          distribution,
                          favorite: false,
                          group: '',
                        },
                        true,
                      )
                    })
                    .catch((error) => setError(String(error)))
                }}
              />
            )}
            <div className={'terminals ' + (!sessions.active || fileTabActive ? 'hidden' : '')}>
              {settings && (
                <SplitWorkspace
                  sessionIds={terminalTabs.map((tab) => tab.id)}
                  activeId={fileTabActive ? undefined : sessions.active}
                  sessionNames={Object.fromEntries(
                    sessions.tabs.map((tab) => [tab.id, tab.profile.name]),
                  )}
                  sessionOptions={terminalTabs.map((tab) => ({
                    id: tab.id,
                    name: tab.profile.name,
                    protocol: tab.profile.protocol,
                  }))}
                  layoutPreset={layoutPreset}
                  onFocus={sessions.setActive}
                  renderSession={(id) => (
                    <TerminalView
                      key={id}
                      sessionId={id}
                      active={id === sessions.active}
                      settings={settings}
                      output={sessions.output}
                      onFontSizeChange={(terminalFontSize) => {
                        setSettings((current) =>
                          current ? { ...current, terminalFontSize } : current,
                        )
                        window.terminalApi.settings
                          .update({ terminalFontSize })
                          .catch((error) => setError(String(error)))
                      }}
                    />
                  )}
                />
              )}
            </div>
            {sessions.tabs
              .filter((tab) => tab.profile.protocol === 'sftp' || tab.profile.protocol === 'ftp')
              .map((tab) => (
                <div
                  className="file-tab-container"
                  key={tab.id}
                  hidden={tab.id !== sessions.active}
                >
                  <FileWorkspace
                    active={tab.id === sessions.active}
                    sessionId={tab.id}
                    state={tab.state}
                    name={tab.profile.name}
                    protocol={tab.profile.protocol}
                  />
                </div>
              ))}
            {monitor && bottomMonitoring && !fileTabActive && (
              <div className="monitor-under-terminal" aria-label="Мониторинг под терминалом">
                <MonitoringPanel
                  placement="under-terminal"
                  visibleItems={settings?.monitoringItems}
                  onVisibleItemsChange={(monitoringItems) => savePreference({ monitoringItems })}
                  activeServerLabel={activeHost?.name}
                  intervalSeconds={settings?.monitoringIntervalSeconds}
                  sessionId={activeTab?.id}
                  profile={activeHost}
                  connected={activeTab?.state === 'connected'}
                />
              </div>
            )}
            {activeTab && (activeTab.error || activeTab.state === 'disconnected') && (
              <div className="session-error">
                <span>{activeTab.error || 'Связь потеряна. Подключитесь снова.'}</span>
                <button
                  onClick={() => {
                    if (activeTab.profile.protocol === 'ssh') setMonitor(true)
                    void sessions.reconnect(activeTab.profile)
                  }}
                >
                  Подключиться снова
                </button>
              </div>
            )}
          </div>
          {files && !fileTabActive && (
            <aside
              className="file-dock"
              aria-label="Файлы"
              style={{ '--file-width': `${settings?.sftpWidth || 380}px` } as CSSProperties}
            >
              {settings && (
                <ResizeHandle
                  reverse
                  label="Ширина файловой панели"
                  value={fileWidth}
                  min={280}
                  max={sharedDocks ? compactMax : 900}
                  onChange={(sftpWidth) => setSettings({ ...settings, sftpWidth })}
                  onCommit={(sftpWidth) => {
                    window.terminalApi.settings
                      .update({ sftpWidth })
                      .catch((error) => setError(String(error)))
                  }}
                />
              )}
              <div className="panel-heading">
                <span>{ru.files}</span>
                <div className="panel-heading-actions">
                  <button
                    className="icon-button"
                    title="Показать локальную панель"
                    aria-label="Локальная панель"
                    aria-pressed={localFilesVisible ?? settings?.sftpMode === 'two-panel'}
                    onClick={() =>
                      setLocalFilesVisible(
                        !(localFilesVisible ?? settings?.sftpMode === 'two-panel'),
                      )
                    }
                  >
                    <Columns2 size={15} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => setFiles(false)}
                    aria-label={ru.close}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <SftpBrowser
                localShell={
                  activeTab?.profile.protocol === 'local' ? activeTab.profile.shell : undefined
                }
                refreshToken={fileRevision}
                mode={
                  (localFilesVisible ?? settings?.sftpMode === 'two-panel')
                    ? 'two-panel'
                    : 'remote-only'
                }
                unsupportedReason={
                  activeTab?.profile.protocol === 'telnet'
                    ? 'Telnet не поддерживает обмен файлами: у протокола нет файлового канала.'
                    : undefined
                }
                sessionId={
                  (activeTab?.profile.protocol === 'ssh' ||
                    activeTab?.profile.protocol === 'wsl' ||
                    activeTab?.profile.protocol === 'local') &&
                  activeTab.state === 'connected'
                    ? activeTab.id
                    : undefined
                }
                onTransfer={(direction, sourceDir, targetDir, entries) => {
                  if (!activeTab) return
                  void enqueueSelection(
                    activeTab.id,
                    direction,
                    sourceDir,
                    targetDir,
                    entries,
                  ).catch((error) => setError(String(error)))
                }}
              />
              <Transfers
                compact
                sessionId={activeTab?.id}
                onFinished={() => setFileRevision((value) => value + 1)}
              />
            </aside>
          )}
          {monitor && !bottomMonitoring && !fileTabActive && (
            <aside
              className="aux-panel"
              aria-label="Мониторинг"
              style={{ '--monitor-width': `${settings?.monitorWidth || 300}px` } as CSSProperties}
            >
              {settings && (
                <ResizeHandle
                  reverse
                  label="Ширина мониторинга"
                  value={sharedDocks ? fileWidth : settings.monitorWidth}
                  min={sharedDocks ? 280 : 220}
                  max={sharedDocks ? compactMax : 450}
                  onChange={(monitorWidth) =>
                    setSettings(
                      sharedDocks
                        ? { ...settings, sftpWidth: monitorWidth }
                        : { ...settings, monitorWidth },
                    )
                  }
                  onCommit={(monitorWidth) => {
                    void window.terminalApi.settings
                      .update(sharedDocks ? { sftpWidth: monitorWidth } : { monitorWidth })
                      .catch((error) => setError(String(error)))
                  }}
                />
              )}
              <div className="panel-heading">
                {ru.monitoring}
                <button
                  className="icon-button"
                  onClick={() => setMonitor(false)}
                  aria-label={ru.close}
                >
                  <X size={16} />
                </button>
              </div>
              <MonitoringPanel
                intervalSeconds={settings?.monitoringIntervalSeconds}
                sessionId={activeTab?.id}
                profile={activeHost}
                connected={activeTab?.state === 'connected'}
              />
            </aside>
          )}
        </div>
      </Shell>
      {appearance && settings && (
        <Appearance
          settings={settings}
          onSaved={setSettings}
          onShortcuts={() => setShortcutsOpen(true)}
          onClose={() => setAppearance(false)}
        />
      )}
      {editor !== undefined && (
        <HostEditor
          profile={editor || undefined}
          initialProtocol={initialProtocol}
          onSave={catalog.save}
          onClose={() => setEditor(undefined)}
        />
      )}
      {quick && (
        <QuickConnect
          onConnect={(profile, secret) => {
            if (profile.protocol === 'ssh') setMonitor(true)
            return sessions.open(profile, true, secret)
          }}
          onClose={() => setQuick(false)}
        />
      )}
      {commandsOpen && (
        <CommandPalette
          onClose={() => setCommandsOpen(false)}
          actions={[
            {
              id: 'local',
              label: 'Открыть локальный терминал',
              detail: 'PowerShell или CMD из настроек',
              shortcut: shortcutKeys('new-local', settings?.shortcutBindings),
              run: () => {
                void sessions.openLocal(settings?.localShell || 'powershell')
              },
            },
            {
              id: 'connect',
              label: 'Быстрое подключение',
              shortcut: shortcutKeys('new-connection', settings?.shortcutBindings),
              run: () => setQuick(true),
            },
            {
              id: 'files',
              label: files ? 'Скрыть файловый браузер' : 'Показать файловый браузер',
              detail: 'Файлы SSH, WSL и этого компьютера',
              run: () => setFiles(!files),
            },
            {
              id: 'monitor',
              label: monitor ? 'Скрыть мониторинг' : 'Показать мониторинг',
              run: () => setMonitor(!monitor),
            },
            { id: 'settings', label: 'Настройки и темы', run: openSettings },
            { id: 'keys', label: 'Все горячие клавиши', run: () => setShortcutsOpen(true) },
            ...catalog.hosts.map((host) => ({
              id: host.id,
              label: `Подключиться: ${host.name}`,
              detail: `${host.favorite ? '★ Избранное · ' : ''}${host.protocol.toUpperCase()} · ${host.protocol === 'wsl' ? host.distribution : host.host}`,
              run: () => openHost(host),
            })),
            ...sessions.tabs.map((tab) => ({
              id: `tab-${tab.id}`,
              label: `Перейти: ${tab.profile.name}`,
              detail: 'Открытая вкладка',
              run: () => sessions.setActive(tab.id),
            })),
          ]}
        />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsDialog
          bindings={settings?.shortcutBindings}
          onSave={async (shortcutBindings) =>
            setSettings(await window.terminalApi.settings.update({ shortcutBindings }))
          }
          onClose={() => setShortcutsOpen(false)}
        />
      )}
      {challenge?.challenge.kind === 'auth' && (
        <AuthDialog
          key={challenge.challenge.id}
          event={challenge}
          protocol={sessions.tabs.find((tab) => tab.id === challenge.sessionId)?.profile.protocol}
          onAnswer={answerChallenge}
          onCancel={() => {
            sessions.close(challenge.sessionId).catch((error) => setError(String(error)))
          }}
        />
      )}
      {challenge?.challenge.kind === 'trust' && (
        <HostKeyDialog key={challenge.challenge.id} event={challenge} onAnswer={answerChallenge} />
      )}
      {removeHost && (
        <div className="modal-backdrop">
          <section className="modal" role="alertdialog" aria-label="Удалить подключение">
            <h2>Удалить «{removeHost.name}»?</h2>
            <p className="muted">
              Сохранённые параметры и секрет будут удалены. Активный сеанс продолжит работу.
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setRemoveHost(undefined)}>
                {ru.cancel}
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  catalog
                    .remove(removeHost.id)
                    .then(() => setRemoveHost(undefined))
                    .catch((error) => setError(String(error)))
                }}
              >
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}
    </>
  )
}
