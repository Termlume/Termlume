import type {
  UpdateStatus,
  HostProfile,
  SshIdentity,
  LocalShellProfile,
  SessionEvent,
  Settings,
  AuthAnswer,
  TrustAnswer,
  FileEntry,
  FileListing,
  FileLocation,
  FileActivity,
  FileDragRequest,
  FileOpenMode,
  FileMutation,
  FileMove,
  TransferRequest,
  TransferSnapshot,
  MetricSnapshot,
} from './contracts'
export interface TerminalApi {
  platform: string
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<void>
    install(): Promise<void>
    onStatus(listener: (status: UpdateStatus) => void): () => void
  }
  app: {
    setTheme?(themeId: Settings['themeId']): void
    onNotice(listener: (message: string) => void): () => void
    onShortcut(
      listener: (shortcut: {
        key: string
        ctrlKey: boolean
        shiftKey: boolean
        altKey?: boolean
      }) => void,
    ): () => void
  }
  wsl: { list(): Promise<string[]> }
  monitoring: {
    setVisible(sessionId: string, visible: boolean): Promise<void>
    retry(sessionId: string): Promise<void>
    onSnapshot(
      listener: (event: { sessionId: string; snapshot: MetricSnapshot }) => void,
    ): () => void
  }
  files: {
    downloadDestination(choose?: boolean): Promise<string | undefined>
    showLocal(path: string): Promise<void>
    onActivity(listener: (activity: FileActivity) => void): () => void
    localRoot(): Promise<string>
    chooseLocal(): Promise<string>
    chooseUpload(): Promise<string[]>
    list(location: FileLocation): Promise<FileListing>
    mutate(request: FileMutation): Promise<void>
    move(request: FileMove): Promise<void>
    enqueue(request: TransferRequest): Promise<string>
    cancel(id: string): Promise<void>
    retry(
      id: string,
      overwrite?: boolean,
      targetVersion?: TransferRequest['targetVersion'],
    ): Promise<string>
    transfers(): Promise<TransferSnapshot[]>
    clearCompleted(sessionId: string): Promise<number>
    openLocal(path: string): Promise<void>
    openBrowserLocal(path: string, mode?: FileOpenMode): Promise<void>
    openRemote(sessionId: string, path: string, mode?: FileOpenMode): Promise<{ localPath: string }>
    enqueueDropped(paths: string[], sessionId: string, targetDirectory: string): Promise<string[]>
    stageDrag(sessionId: string, path: string): Promise<{ token: string; fileName: string }>
    beginExternalDrag(request: FileDragRequest): Promise<boolean>
    getPathForFile(file: File): string
    onTransfer(listener: (entry: TransferSnapshot) => void): () => void
  }
  hosts: {
    list(): Promise<HostProfile[]>
    save(profile: HostProfile): Promise<HostProfile>
    remove(id: string): Promise<void>
    setSecret(id: string, value: string): Promise<void>
  }
  identities: {
    list(): Promise<SshIdentity[]>
    save(identity: SshIdentity, secret?: string): Promise<SshIdentity>
    remove(id: string, options?: { replacementId?: string; detach?: boolean; confirmMerge?: boolean }): Promise<void>
    chooseKey(): Promise<string | undefined>
    discoverSsh(): Promise<SshIdentity[]>
  }
  settings: { get(): Promise<Settings>; update(patch: Partial<Settings>): Promise<Settings> }
  data: {
    export(passphrase: string): Promise<void>
    previewImport(passphrase: string): Promise<
      | {
          token: string
          hosts: number
          identities: number
          conflicts: { hosts: number; identities: number; knownHosts: number }
        }
      | undefined
    >
    commitImport(token: string, strategy: 'merge' | 'replace'): Promise<Settings>
  }
  sessions: {
    open(profileId: string): Promise<string>
    openLocal(shell: LocalShellProfile['shell']): Promise<string>
    openTemporary(profile: HostProfile, secret?: string): Promise<string>
    answer(challengeId: string, answer: AuthAnswer | TrustAnswer): Promise<void>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    ack(id: string, sequence: number): Promise<void>
    close(id: string): Promise<'closed' | 'canceled'>
    onEvent(listener: (event: SessionEvent) => void): () => void
  }
}
