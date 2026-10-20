import { expect, it } from 'vitest'
import { resolveWslRoot } from '../../src/main/platform/wsl-files'
import { listWslDistributions, wslRoot } from '../../src/main/platform/wsl'
import { WslFileAccess } from '../../src/main/sftp/WslFileAccess'

it('normalizes wslpath output to a distribution UNC root', async () => {
  await expect(
    resolveWslRoot('Ubuntu', async () => ' \\\\wsl.localhost\\Ubuntu\\\r\n'),
  ).resolves.toBe('\\\\wsl.localhost\\Ubuntu')
  await expect(resolveWslRoot('Debian', async () => '\\\\wsl$\\Debian\\')).resolves.toBe(
    '\\\\wsl$\\Debian',
  )
})

it('rejects missing distributions and non-UNC wslpath results', async () => {
  await expect(resolveWslRoot('', async () => '')).rejects.toMatchObject({
    code: 'wsl-distribution-required',
  })
  await expect(resolveWslRoot('Ubuntu', async () => '')).rejects.toMatchObject({
    code: 'wsl-files-unavailable',
  })
  await expect(resolveWslRoot('Ubuntu', async () => 'C:\\')).rejects.toMatchObject({
    code: 'wsl-files-unavailable',
  })
})

const installedDistributions = await listWslDistributions().catch(() => [])
it.skipIf(installedDistributions.length === 0)(
  'probes an available installed WSL distribution through its UNC root',
  async () => {
    let selected: { distribution: string; root: string } | undefined
    for (const candidate of installedDistributions) {
      try {
        selected = { distribution: candidate, root: await wslRoot(candidate) }
        break
      } catch {
        // An installed distribution can be damaged or unavailable independently of WSL.
      }
    }
    expect(selected, 'at least one installed WSL distribution must start').toBeDefined()
    const { distribution, root } = selected!
    const listing = await new WslFileAccess().list(root, '.')
    expect(root.toLowerCase()).toContain(distribution.toLowerCase())
    expect(listing.mode).toBe('wsl')
    expect(Array.isArray(listing.entries)).toBe(true)
  },
  30000,
)
