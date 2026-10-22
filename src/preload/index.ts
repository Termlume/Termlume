import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionEvent, FileDragRequest, FileOpenMode, UpdateStatus } from '../shared/contracts'
async function call(action: string, params: Record<string, unknown> = {}) {
  const response = await ipcRenderer.invoke('terminal:request', { action, ...params })
  if (!response.ok)
    throw Object.assign(new Error(response.error.message), { code: response.error.code })
  return response.value
}
contextBridge.exposeInMainWorld('terminalApi', {
  platform: process.platform,
  x11: {
    status: () => call('x11.status'),
    start: () => call('x11.start'),
    stop: () => call('x11.stop'),
  },
  logs: {
    settings: () => call('logs.settings'),
    configure: (patch: unknown) => call('logs.configure', { patch }),
    chooseFolder: () => call('logs.chooseFolder'),
    list: () => call('logs.list'),
    start: (sessionId: string) => call('logs.start', { sessionId }),
    stop: (sessionId: string) => call('logs.stop', { sessionId }),
    read: (id: string) => call('logs.read', { id }),
    bookmark: (id: string, bookmarked: boolean) => call('logs.bookmark', { id, bookmarked }),
    export: (id: string) => call('logs.export', { id }),
  },
  updates: {
    status: () => call('updates.status'),
    check: () => call('updates.check'),
    download: () => call('updates.download'),
    install: () => call('updates.install'),
    onStatus: (listener: (status: UpdateStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status)
      ipcRenderer.on('terminal:update-status', handler)
      return () => ipcRenderer.removeListener('terminal:update-status', handler)
    },
  },
  app: {
    openUrl: (url: string) => call('app.openUrl', { url }),
    setTheme: (themeId: string) => ipcRenderer.send('terminal:theme', themeId),
    onNotice: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
      ipcRenderer.on('terminal:notice', handler)
      return () => ipcRenderer.removeListener('terminal:notice', handler)
    },
    onShortcut: (
      listener: (shortcut: {
        key: string
        ctrlKey: boolean
        shiftKey: boolean
        altKey?: boolean
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean },
      ) => listener(value)
      ipcRenderer.on('terminal:shortcut', handler)
      return () => ipcRenderer.removeListener('terminal:shortcut', handler)
    },
  },
  wsl: { list: () => call('wsl.list'), inventory: () => call('wsl.inventory') },
  monitoring: {
    setVisible: (sessionId: string, visible: boolean) =>
      call('monitoring.setVisible', { sessionId, visible }),
    retry: (sessionId: string) => call('monitoring.retry', { sessionId }),
    onSnapshot: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)
      ipcRenderer.on('terminal:metric', handler)
      return () => ipcRenderer.removeListener('terminal:metric', handler)
    },
  },
  files: {
    downloadDestination: (choose?: boolean) => call('files.downloadDestination', { choose }),
    showLocal: (path: string) => call('files.showLocal', { path }),
    onActivity: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)
      ipcRenderer.on('terminal:file-activity', handler)
      return () => ipcRenderer.removeListener('terminal:file-activity', handler)
    },
    enqueue: (request: Record<string, unknown>) => call('files.enqueue', request),
    cancel: (id: string) => call('files.cancel', { id }),
    retry: (id: string, overwrite = false, targetVersion?: unknown) =>
      call('files.retry', { id, overwrite, targetVersion }),
    transfers: () => call('files.transfers'),
    clearCompleted: (sessionId: string) => call('files.clearCompleted', { sessionId }),
    openLocal: (path: string) => call('files.openLocal', { path }),
    openBrowserLocal: (path: string, mode: FileOpenMode = 'default') =>
      call('files.openBrowserLocal', { path, mode }),
    openRemote: (sessionId: string, path: string, mode: FileOpenMode = 'default') =>
      call('files.openRemote', { sessionId, path, mode }),
    enqueueDropped: (paths: string[], sessionId: string, targetDirectory: string) =>
      call('files.enqueueDropped', { paths, sessionId, targetDirectory }),
    stageDrag: (sessionId: string, path: string) => call('files.stageDrag', { sessionId, path }),
    beginExternalDrag: (request: FileDragRequest) =>
      ipcRenderer.invoke('terminal:begin-external-drag', request).then((response) => {
        if (!response?.ok) throw new Error(response?.error?.message || 'Не удалось перенести файл')
        return response.value === true
      }),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    onTransfer: (listener: (entry: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)
      ipcRenderer.on('terminal:transfer', handler)
      return () => ipcRenderer.removeListener('terminal:transfer', handler)
    },
    localRoot: () => call('files.localRoot'),
    chooseLocal: () => call('files.chooseLocal'),
    chooseUpload: () => call('files.chooseUpload'),
    list: (location: Record<string, unknown>) => call('files.list', location),
    mutate: (request: Record<string, unknown>) => call('files.mutate', request),
    move: (request: Record<string, unknown>) => call('files.move', request),
  },
  hosts: {
    list: () => call('hosts.list'),
    save: (profile: unknown) => call('hosts.save', { profile }),
    remove: (id: string) => call('hosts.remove', { id }),
    setSecret: (id: string, value: string) => call('hosts.setSecret', { id, value }),
  },
  identities: {
    list: () => call('identities.list'),
    save: (identity: unknown, secret?: string) => call('identities.save', { identity, secret }),
    remove: (
      id: string,
      options?: { replacementId?: string; detach?: boolean; confirmMerge?: boolean },
    ) => call('identities.remove', { id, ...options }),
    chooseKey: () => call('identity.chooseKey'),
    discoverSsh: () => call('ssh.discoverIdentities'),
  },
  settings: {
    get: () => call('settings.get'),
    update: (patch: unknown) => call('settings.update', { patch }),
  },
  data: {
    export: (passphrase: string) => call('data.export', { passphrase }),
    previewImport: (passphrase: string) => call('data.previewImport', { passphrase }),
    commitImport: (token: string, strategy: 'merge' | 'replace') =>
      call('data.commitImport', { token, strategy }),
  },
  sessions: {
    answer: (challengeId: string, answer: unknown) =>
      call('sessions.answer', { challengeId, answer }),
    open: (profileId: string) => call('sessions.open', { profileId }),
    openLocal: (shell: 'powershell' | 'cmd') => call('sessions.openLocal', { shell }),
    openTemporary: (profile: unknown, secret?: string) =>
      call('sessions.openTemporary', { profile, secret }),
    write: (id: string, data: string) => call('sessions.write', { id, data }),
    resize: (id: string, cols: number, rows: number) => call('sessions.resize', { id, cols, rows }),
    ack: (id: string, sequence: number) => call('sessions.ack', { id, sequence }),
    close: (id: string) => call('sessions.close', { id }),
    onEvent: (listener: (event: SessionEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: SessionEvent) => listener(value)
      ipcRenderer.on('terminal:event', handler)
      return () => ipcRenderer.removeListener('terminal:event', handler)
    },
  },
})
