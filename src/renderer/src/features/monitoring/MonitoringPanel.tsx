import { Activity, HardDrive } from 'lucide-react'
import type { DiskMetrics, HostProfile, Metric } from '../../../../shared/contracts'
import { useMonitoring } from './useMonitoring'
import { CapacityBar } from './CapacityBar'
import type { MonitorItem } from '../../../../shared/monitoring-items'
import { MonitoringBar } from './MonitoringBar'
import './monitoring.css'
export { bytes } from './format'
export function DiskCard({
  disks,
  sampledAt,
}: {
  disks?: Metric<DiskMetrics[]>
  sampledAt?: number
}) {
  return (
    <section className="metric-card">
      <div className="metric-label">
        <HardDrive size={12} />
        ДИСКИ
      </div>
      {disks?.status === 'ok' ? (
        (disks.value || []).map((disk) => (
          <div className="disk-row" key={disk.device + disk.mount}>
            <div>
              <span title={disk.mount}>{disk.mount}</span>
              <strong title={disk.device}>{disk.device}</strong>
            </div>
            <CapacityBar label={`Диск ${disk.mount}`} usage={disk} />
          </div>
        ))
      ) : (
        <p className="metric-reason">{disks?.error || 'Ожидание данных'}</p>
      )}
      <small className="disk-timestamp">
        {sampledAt
          ? 'Обновлено ' + new Date(sampledAt).toLocaleTimeString('ru-RU')
          : 'Интервал обновления: 30 секунд'}
      </small>
    </section>
  )
}
export function MonitoringPanel({
  sessionId,
  profile,
  connected,
  intervalSeconds = 3,
  placement = 'sidebar',
  activeServerLabel,
  visibleItems,
  onVisibleItemsChange,
  onResetItems,
}: {
  sessionId?: string
  profile?: HostProfile
  connected: boolean
  intervalSeconds?: number
  placement?: 'sidebar' | 'under-terminal'
  activeServerLabel?: string
  visibleItems?: MonitorItem[]
  onVisibleItemsChange?: (items: MonitorItem[]) => void
  onResetItems?: () => void
}) {
  const enabled = !!profile && profile.protocol === 'ssh' && connected
  const { snapshot, error, retry } = useMonitoring(sessionId, enabled, true)
  if (!enabled)
    return (
      <div className="panel-empty">
        <Activity size={25} />
        <h3>Мониторинг Linux</h3>
        <p>
          {!profile || !connected
            ? 'Подключитесь к Linux-серверу, чтобы видеть его ресурсы.'
            : profile.protocol !== 'ssh'
              ? 'Мониторинг доступен в SSH-сеансах Linux.'
              : 'Включите «Мониторинг Linux» в настройках подключения и откройте новый сеанс.'}
        </p>
      </div>
    )
  return (
    <div className={placement === 'sidebar' ? 'monitoring-content' : 'monitoring-bottom'}>
      {error && <p className="error-message">{error}</p>}
      {snapshot && snapshot.state !== 'sampling' && (
        <div className="monitor-warning">
          <p>{snapshot.error}</p>
          {snapshot.state !== 'unsupported' && (
            <button className="text-button" onClick={retry}>
              Повторить опрос
            </button>
          )}
        </div>
      )}
      <MonitoringBar
        key={sessionId}
        snapshot={snapshot}
        server={activeServerLabel || profile.name}
        visibleItems={visibleItems}
        onVisibleItemsChange={onVisibleItemsChange}
        onResetItems={onResetItems}
        expanded={placement === 'sidebar'}
      />
      {placement === 'sidebar' && (
        <p className="monitor-footer">
          Обновление: {intervalSeconds} с · Графики за последние 5 минут
        </p>
      )}
    </div>
  )
}
