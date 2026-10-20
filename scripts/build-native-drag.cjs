const { spawnSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
if (process.platform !== 'win32') process.exit(0)
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'native/windows-drag/bin')
mkdirSync(output, { recursive: true })
const compiler = path.join(
  process.env.WINDIR || 'C:\\Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
)
const result = spawnSync(
  compiler,
  [
    '/nologo',
    '/target:exe',
    '/optimize+',
    '/platform:x64',
    '/reference:System.Web.Extensions.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:Microsoft.CSharp.dll',
    ...['WindowsBase.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll'].map(
      (name) => '/reference:' + path.join(path.dirname(compiler), 'WPF', name),
    ),
    `/out:${path.join(output, 'Termlume.FileDrag.exe')}`,
    path.join(root, 'native/windows-drag/Program.cs'),
    path.join(root, 'native/windows-drag/WindowsDropTracker.cs'),
    path.join(root, 'native/windows-drag/DesktopGestureSmoke.cs'),
  ],
  { stdio: 'inherit', windowsHide: true },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
