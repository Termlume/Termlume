const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Native dependencies must be rebuilt inside a separate Linux checkout/install.
if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error(
    'Linux packaging requires Linux x86_64 with its own node_modules. Run npm ci in a Linux staging directory first.',
  )
  process.exit(1)
}

// A Windows Electron download identifies a shared Windows dependency tree.
if (path.extname(require('electron')).toLowerCase() === '.exe') {
  console.error(
    'Windows node_modules detected. Install dependencies in a separate Linux staging directory.',
  )
  process.exit(1)
}

const root = path.resolve(__dirname, '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const output = `dist-releases/linux-${stamp}`
const configPath = path.join(root, `electron-builder.linux.${process.pid}.local.yml`)
const builder = path.join(root, 'node_modules/electron-builder/out/cli/cli.js')
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Linux build command failed (${result.status})`)
}
async function main() {
  try {
    // npmRebuild is disabled in the shared config; explicitly prepare Electron's ABI.
    const { rebuild } = await import('@electron/rebuild')
    await rebuild({
      buildPath: root,
      electronVersion: require('electron/package.json').version,
      arch: 'x64',
      platform: 'linux',
      onlyModules: ['node-pty'],
      force: true,
    })
    run([path.join(root, 'scripts/build-linux-drag.cjs')])
    run([path.join(root, 'scripts/check-native.cjs')])
    run([path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'])
    run([path.join(root, 'scripts/collect-licenses.cjs')])
    fs.writeFileSync(
      configPath,
      fs
        .readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
        .replace("'output': 'dist'", `'output': '${output}'`),
    )
    run([
      builder,
      '--linux',
      'AppImage',
      'deb',
      '--x64',
      '--publish',
      'never',
      '--config',
      configPath,
    ])
    // Linux has separate feed files; never modify the Windows channel manifests.
    const metadata = fs.readFileSync(path.join(root, output, 'latest-linux.yml'))
    for (const channel of ['alpha', 'beta'])
      fs.writeFileSync(path.join(root, output, `${channel}-linux.yml`), metadata)
    console.log(`Linux packages: ${path.join(root, output)}`)
  } finally {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
