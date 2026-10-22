export interface SessionLogConfig {
  folder: string
  auto: boolean
  hostIds: string[]
  retentionDays: number
  maxSizeMb: number
}
export interface SessionLogEntry {
  id: string
  sessionId: string
  label: string
  startedAt: number
  bookmarked: boolean
  bytes: number
  active: boolean
}
