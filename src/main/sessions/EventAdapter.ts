import type { AdapterEvent } from '../../shared/contracts'
export class EventAdapter {
  private listeners = new Set<(event: AdapterEvent) => void>()
  subscribe(listener: (event: AdapterEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  protected emit(event: AdapterEvent) {
    this.listeners.forEach((listener) => listener(event))
  }
}
