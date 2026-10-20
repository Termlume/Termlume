type Listener = (bytes: Uint8Array, sequence: number) => void
export class SessionOutputRouter {
  private listeners = new Map<string, Listener>()
  private pending = new Map<string, { bytes: Uint8Array; sequence: number }[]>()
  push(id: string, bytes: Uint8Array, sequence: number) {
    const listener = this.listeners.get(id)
    if (listener) listener(bytes, sequence)
    else {
      const values = this.pending.get(id) || []
      values.push({ bytes, sequence })
      this.pending.set(id, values)
    }
  }
  subscribe(id: string, listener: Listener) {
    this.listeners.set(id, listener)
    const pending = this.pending.get(id) || []
    this.pending.delete(id)
    pending.forEach((value) => listener(value.bytes, value.sequence))
    return () => {
      if (this.listeners.get(id) === listener) this.listeners.delete(id)
    }
  }
  remove(id: string) {
    this.listeners.delete(id)
    this.pending.delete(id)
  }
}
