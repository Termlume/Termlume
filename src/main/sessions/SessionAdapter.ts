import type { AdapterEvent } from '../../shared/contracts'
export interface SessionAdapter {
  connect(signal: AbortSignal): Promise<void>
  write(data: string): void
  resize(cols: number, rows: number): void
  pauseOutput(): void
  resumeOutput(): void
  close(): Promise<void>
  subscribe(listener: (event: AdapterEvent) => void): () => void
}
