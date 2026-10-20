export function diagnosticRecord(
  event: string,
  metadata: { protocol?: string; phase?: string; activeSessions?: number } = {},
) {
  const protocols = ['ssh', 'telnet', 'wsl'],
    phases = ['connecting', 'connected', 'disconnected', 'closing', 'error']
  return {
    timestamp: new Date().toISOString(),
    event: /^[a-z0-9-]{1,64}$/.test(event) ? event : 'unknown',
    protocol: protocols.includes(metadata.protocol || '') ? metadata.protocol : undefined,
    phase: phases.includes(metadata.phase || '') ? metadata.phase : undefined,
    activeSessions:
      typeof metadata.activeSessions === 'number' && Number.isFinite(metadata.activeSessions)
        ? metadata.activeSessions
        : undefined,
  }
}
