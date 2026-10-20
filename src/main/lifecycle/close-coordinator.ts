export interface CloseSummary {
  sessions: number
  transfers: number
}
export class CloseCoordinator {
  private pending = new Map<string, Promise<'closed' | 'canceled'>>()
  constructor(
    private summary: (ownerId: number, sessionId?: string) => CloseSummary,
    private confirm: (summary: CloseSummary) => Promise<boolean>,
    private disposeOwner: (ownerId: number) => Promise<void>,
    private disposeSession: (ownerId: number, id: string) => Promise<void>,
  ) {}
  private run(key: string, ownerId: number, id?: string): Promise<'closed' | 'canceled'> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const operation = Promise.resolve()
      .then(async () => {
        const summary = this.summary(ownerId, id)
        if ((summary.sessions || summary.transfers) && !(await this.confirm(summary)))
          return 'canceled' as const
        if (id) await this.disposeSession(ownerId, id)
        else await this.disposeOwner(ownerId)
        return 'closed' as const
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }
  requestWindowClose(ownerId: number) {
    return this.run('window:' + ownerId, ownerId)
  }
  requestSessionClose(ownerId: number, id: string) {
    return this.run('session:' + ownerId + ':' + id, ownerId, id)
  }
}
