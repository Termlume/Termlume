import { Activity, Clock3, HardDrive, ArrowDown, ArrowUp } from 'lucide-react'
import type { DiskMetrics, HostProfile, Metric, MemoryUsage } from '../../../../shared/contracts'
import { useMonitoring } from './useMonitoring'
import { MetricCard } from './MetricCard'
import { HistoryChart } from './HistoryChart'
import { bytes } from './format'
import { CapacityBar } from './CapacityBar'
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
const pending = <T,>(): Metric<T> => ({ status: 'warming-up', error: 'Ожидание данных сервера' })
export function MonitoringPanel({
  sessionId,
  profile,
  connected,
  intervalSeconds = 3,
}: {
  sessionId?: string
  profile?: HostProfile
  connected: boolean
  intervalSeconds?: number
}) {
  const enabled = !!profile && profile.protocol === 'ssh' && connected
  const { snapshot, error, retry } = useMonitoring(sessionId, enabled, true),
    history = snapshot?.history || []
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
    <div className="monitoring-content">
      <div className="monitor-server">
        <span className="status-dot" />
        <span>{profile.name}</span>
        <span className="monitor-live">Обновление: {intervalSeconds} с</span>
      </div>
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
      <MetricCard
        label="ПРОЦЕССОР"
        metric={snapshot?.cpuPercent || pending<number>()}
        format={(value) => value.toFixed(1) + '%'}
      >
        <HistoryChart
          values={history.map((point) => point.cpuPercent)}
          label="Загрузка CPU за последние 5 минут"
        />
      </MetricCard>
      <MetricCard
        label="ОПЕРАТИВНАЯ ПАМЯТЬ"
        metric={snapshot?.ram || pending<MemoryUsage>()}
        format={(value) => bytes(value.used)}
      >
        <CapacityBar
          label="Оперативная память"
          usage={snapshot?.ram.status === 'ok' ? snapshot.ram.value : undefined}
        />
      </MetricCard>
      <MetricCard
        label="SWAP"
        metric={snapshot?.swap || pending<MemoryUsage>()}
        format={(value) => (value.total === 0 ? 'Не настроен' : bytes(value.used))}
      >
        <CapacityBar
          label="Swap"
          usage={snapshot?.swap.status === 'ok' ? snapshot.swap.value : undefined}
        />
      </MetricCard>
      <section className="metric-card">
        <div className="metric-label">
          СЕТЬ
          <span className={'metric-dot ' + (snapshot?.network.status || 'warming-up')} />
        </div>
        <div className="network-values">
          <span>
            <ArrowDown size={12} />
            {snapshot?.network.status === 'ok'
              ? bytes(snapshot.network.value!.rx) + '/с'
              : snapshot?.network.status === 'unavailable'
                ? 'Недоступно'
                : 'Измерение…'}
          </span>
          <span>
            <ArrowUp size={12} />
            {snapshot?.network.status === 'ok' ? bytes(snapshot.network.value!.tx) + '/с' : '—'}
          </span>
        </div>
        <HistoryChart
          values={history.map((point) => point.rx)}
          max={0}
          color="var(--green)"
          label="Входящий сетевой трафик"
        />
        <HistoryChart
          values={history.map((point) => point.tx)}
          max={0}
          color="var(--accent)"
          label="Исходящий сетевой трафик"
        />
        {snapshot?.network.error && <p className="metric-reason">{snapshot.network.error}</p>}
      </section>
      <DiskCard disks={snapshot?.disks} sampledAt={snapshot?.disks.sampledAt} />
      <div className="uptime">
        <Clock3 size={13} />
        <span>Uptime</span>
        <strong>
          {snapshot?.uptime.status === 'ok'
            ? Math.floor(snapshot.uptime.value! / 86400) +
              'д ' +
              Math.floor((snapshot.uptime.value! % 86400) / 3600) +
              'ч ' +
              Math.floor((snapshot.uptime.value! % 3600) / 60) +
              'м'
            : 'Недоступно'}
        </strong>
      </div>
      <p className="monitor-footer">
        {snapshot
          ? 'Измерено ' + new Date(snapshot.sampledAt).toLocaleTimeString('ru-RU')
          : 'Соединение с сервером…'}
        <br />
        Графики за последние 5 минут
      </p>
    </div>
  )
}
