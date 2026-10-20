export type SessionId = string
export type SessionState =
  | 'disconnected'
  | 'connecting'
  | 'awaiting-auth'
  | 'awaiting-host-verification'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'closing'
interface HostBase {
  tags?: string[]
  id: string
  name: string
  group: string
  favorite: boolean
  color?: string
}
export type HostProfile = HostBase &
  (
    | {
        protocol: 'ssh'
        host: string
        port: number
        username: string
        auth: 'password' | 'key'
        identityId?: string
        keyPath?: string
        secretRef?: string
        monitoringEnabled: boolean
      }
    | {
        protocol: 'sftp'
        host: string
        port: number
        username: string
        auth: 'password' | 'key'
        identityId?: string
        keyPath?: string
        secretRef?: string
      }
    | {
        protocol: 'ftp'
        host: string
        port: number
        username: string
        security: 'none' | 'explicit-tls' | 'implicit-tls'
        secretRef?: string
      }
    | {
        protocol: 'telnet'
        host: string
        port: number
        encoding: 'utf8' | 'windows-1251' | 'cp866'
      }
    | { protocol: 'wsl'; distribution: string }
  )
export interface LocalShellProfile {
  protocol: 'local'
  name: string
  shell: 'powershell' | 'cmd'
}
export type SessionProfile = HostProfile | LocalShellProfile
export interface SshIdentity {
  id: string
  name: string
  method: 'password' | 'key' | 'agent'
  secretRef?: string
  keyPath?: string
  agentEndpoint?: string
  agentFingerprint?: string
}
export type SafeError = { code: string; message: string; retryable: boolean }
export type AdapterEvent =
  | { type: 'state'; state: SessionState }
  | { type: 'data'; data: Uint8Array }
  | { type: 'error'; error: SafeError }
  | {
      type: 'challenge'
      challenge: {
        id: string
        kind: 'auth' | 'trust'
        fingerprint?: string
        algorithm?: string
        changed?: boolean
        host?: string
        canRemember?: boolean
        authType?: 'password' | 'key'
      }
    }
  | { type: 'closed'; reason?: 'remote-exit' | 'transport' }
export type SessionEvent = AdapterEvent & { sessionId: string; sequence: number }
export type AuthAnswer = { kind: 'auth'; password?: string; passphrase?: string; remember: boolean }
export type TrustAnswer = { kind: 'trust'; accept: boolean; replaceExisting: boolean }
export type TransferState = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export interface TransferRequest {
  sessionId: string
  direction: 'upload' | 'download'
  source: string
  target: string
  overwrite: boolean
  targetVersion?: { size: number; modifiedAt: number }
}
export interface TransferSnapshot {
  id: string
  sessionId: string
  direction: 'upload' | 'download'
  source: string
  target: string
  state: TransferState
  bytesDone: number
  bytesTotal: number
  error?: SafeError
  conflict?: { size: number; modifiedAt: number }
}
export interface Metric<T> {
  status: 'ok' | 'warming-up' | 'unavailable'
  value?: T
  error?: string
  sampledAt?: number
}
export interface MemoryUsage {
  cached?: number
  buffers?: number
  total: number
  available: number
  used: number
}
export interface DiskMetrics {
  device: string
  mount: string
  total: number
  used: number
  available: number
  percent: number
}
export interface NetworkRates {
  rx: number
  tx: number
  interfaces: { name: string; rx: number; tx: number }[]
}
export interface MetricPoint {
  sampledAt: number
  cpuPercent?: number
  ramPercent?: number
  rx?: number
  tx?: number
}
export interface SystemMetrics {
  hostname?: string
  loadAverage?: number[]
  processes?: { running: number; total: number }
  fileDescriptors?: { allocated: number; maximum: number }
  connections?: {
    total: number
    ports: { port: number; count: number }[]
    details?: string
    source?: 'ss' | 'netstat'
    truncated?: boolean
  }
  nfsMounts?: { source: string; mount: string; type: string }[]
}
export interface MetricSnapshot {
  system?: Metric<SystemMetrics>
  users?: Metric<{
    sessions: {
      source?: 'who' | 'loginctl' | 'process' | 'current-connection'
      user: string
      terminal: string
      loginText?: string
      from?: string
    }[]
  }>
  sampledAt: number
  state: 'sampling' | 'paused' | 'error' | 'unsupported'
  error?: string
  cpuPercent: Metric<number>
  ram: Metric<MemoryUsage>
  swap: Metric<MemoryUsage>
  disks: Metric<DiskMetrics[]>
  network: Metric<NetworkRates>
  uptime: Metric<number>
  history: MetricPoint[]
}
export interface FileEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifiedAt: number
  isSymlink: boolean
  permissions?: number
  owner?: string
  group?: string
}
export type FileAccessMode = 'sftp' | 'scp' | 'ftp' | 'ftps' | 'wsl' | 'local'
export interface FileCapabilities {
  list: boolean
  upload: boolean
  download: boolean
  mkdir: boolean
  rename: boolean
  remove: boolean
  chmod: boolean
  chown: boolean
  dragOut: boolean
}
export interface FileListing {
  path: string
  entries: FileEntry[]
  mode: FileAccessMode
  capabilities: FileCapabilities
}
export interface FileLocation {
  side: 'local' | 'remote'
  path: string
  sessionId?: string
}
export interface FileDragRequest {
  sessionId: string
  path: string
  size: number
  modifiedAt: number
}
export interface FileMove extends FileLocation {
  destination: string
}
export interface FileMutation extends FileLocation {
  operation: 'mkdir' | 'rename' | 'remove' | 'chmod' | 'chown'
  name?: string
  fileType?: 'file' | 'empty-directory'
  permissions?: number
  owner?: string
  group?: string
}
export type ThemeId =
  | 'catppuccin-mocha'
  | 'catppuccin-macchiato'
  | 'catppuccin-frappe'
  | 'catppuccin-latte'
  | 'vscode-dark-modern'
  | 'vscode-light-modern'
  | 'tokyo-night'
  | 'one-dark'
export type UpdateChannel = 'stable' | 'prerelease'
export interface UpdateStatus {
  state:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
  currentVersion: string
  channel: UpdateChannel
  version?: string
  releaseName?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  error?: string
  message?: string
}
export interface Settings {
  dismissedUpdateVersion?: string
  updateChannelPolicy?: 1
  monitoringItems?: import('./monitoring-items').MonitorItem[]
  connectionsCollapsed?: boolean
  collapsedHostGroups?: string[]
  monitoringPlacement?: 'sidebar' | 'under-terminal'
  updateChannel?: UpdateChannel
  shortcutBindings?: import('./keyboard-shortcuts').ShortcutBindings
  themeId: ThemeId
  terminalFont: string
  terminalFontSize: number
  sidebarWidth: number
  monitoringIntervalSeconds: number
  monitorWidth: number
  sftpWidth?: number
  sftpHeight: number
  windowBounds: { width: number; height: number }
  sftpMode: 'two-panel' | 'remote-only'
  mouseAction: 'select-copy-right-paste' | 'context-menu' | 'manual'
  localShell: 'powershell' | 'cmd'
  smoothInput: boolean
}

export interface FileActivity {
  sessionId: string
  path: string
  kind: 'open' | 'download' | 'save'
  state: 'running' | 'done' | 'error'
  completed: number
  total?: number
  error?: string
}

export type FileOpenMode = 'default' | 'choose' | 'text'
