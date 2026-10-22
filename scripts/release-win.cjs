const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const output = `dist-releases/${stamp}`
const configPath = path.join(root, 'electron-builder.release.local.yml')
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Release command failed (${result.status})`)
}
try {
  run([path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'])
  run([path.join(root, 'scripts/build-native-drag.cjs')])
  run([path.join(root, 'scripts/prepare-x11.cjs')])
  run([path.join(root, 'scripts/collect-licenses.cjs')])
  fs.writeFileSync(
    configPath,
    fs
      .readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
      .replace("'output': 'dist'", `'output': '${output}'`),
  )
  run([
    path.join(root, 'node_modules/electron-builder/out/cli/cli.js'),
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
    '--config',
    configPath,
  ])
  const version = require('../package.json').version
  require('./prepare-update-metadata.cjs')(path.join(root, output), version)
  const release = {
    builtAt: new Date().toISOString(),
    executable: path.join(root, output, 'win-unpacked', 'Termlume.exe'),
    installer: path.join(root, output, `Termlume-Setup-${version}-x64.exe`),
  }
  fs.writeFileSync(path.join(root, 'latest-release.json'), JSON.stringify(release, null, 2) + '\n')
  console.log(JSON.stringify(release, null, 2))
} finally {
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
}
