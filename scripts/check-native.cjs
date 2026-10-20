const { spawnSync } = require('node:child_process')
const electron = require('electron')
const result = spawnSync(electron, [require('node:path').join(__dirname, 'native-probe.cjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 15000,
  windowsHide: true,
})
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
