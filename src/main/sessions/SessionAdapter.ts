import type { AdapterEvent } from '../../shared/contracts'
export interface SessionAdapter {
  readonly cwdUsername?: string
  connect(signal: AbortSignal): Promise<void>
  write(data: string): void
  resize(cols: number, rows: number): void
  pauseOutput(): void
  resumeOutput(): void
  close(): Promise<void>
  subscribe(listener: (event: AdapterEvent) => void): () => void
}
