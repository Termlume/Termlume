const pty = require('node-pty')
let seen = false
const term = pty.spawn(
  'powershell.exe',
  [
    '-NoLogo',
    '-NoProfile',
    '-Command',
    '[Console]::WriteLine("PTY_READY"); Start-Sleep -Milliseconds 700',
  ],
  { cols: 80, rows: 24 },
)
const timer = setTimeout(() => {
  term.kill()
  process.exit(1)
}, 10000)
term.onData((data) => {
  if (!seen && data.includes('PTY_READY')) {
    seen = true
    term.resize(100, 30)
  }
})
term.onExit(() => {
  clearTimeout(timer)
  console.log(seen ? 'PTY_OK' : 'PTY_FAILED')
  process.exit(seen ? 0 : 1)
})
