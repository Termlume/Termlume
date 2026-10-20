import { HostEditor } from './HostEditor'
import type { HostProfile } from '../../../../shared/contracts'
export function QuickConnect({
  onConnect,
  onClose,
}: {
  onConnect: (profile: HostProfile, secret?: string) => Promise<void>
  onClose: () => void
}) {
  return <HostEditor quick onSave={onConnect} onClose={onClose} />
}
