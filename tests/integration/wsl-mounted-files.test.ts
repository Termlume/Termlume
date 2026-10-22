import { expect, it } from 'vitest'
import { join } from 'node:path'
import { WslFileAccess } from '../../src/main/sftp/WslFileAccess'
import { listWslInventory } from '../../src/main/platform/wsl'

// Explicit opt-in: these checks read the host's running default distribution.
it.runIf(process.env.TERMLUME_LIVE_WSL === '1')(
  'reads Windows mounts through Linux and resolves their accessible Windows paths',
  async () => {
    const inventory = await listWslInventory()
    const selected = inventory.find((item) => item.isDefault)
    expect(selected).toBeDefined()
    const root = `\\\\wsl.localhost\\${selected!.name}`
    const files = new WslFileAccess()
    const mounts = await files.list(root, join(root, 'mnt'))
    expect(mounts.entries.find((entry) => entry.name === 'c')?.type).toBe('directory')
    const drive = await files.list(root, join(root, 'mnt', 'c'))
    expect(drive.entries.some((entry) => entry.name === 'Windows')).toBe(true)
    expect(await files.accessiblePath(root, join(root, 'mnt', 'c', 'Windows'))).toMatch(
      /^c:\\windows$/i,
    )
  },
)
