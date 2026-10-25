if (process.platform !== 'win32') process.exit(0)
// Extract upstream installers into the project. Never run an installer.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const cache = path.join(root, 'build/x11-download')
const destination = path.join(root, 'build/x11')
const source = path.join(root, 'build/x11-source')
const commit = 'b1c7712a2584b263f44fa24e8c493f4f59c472ea'
const assets = [
  [
    'vcxsrv.exe',
    'https://github.com/marchaesen/vcxsrv/releases/download/21.1.16.1/vcxsrv-64.21.1.16.1.installer.exe',
    'df7fed8f49665d0592528ab6be9d07111ea73c6848283d128b77690e05b8f90b',
  ],
  [
    '7zip.exe',
    'https://www.7-zip.org/a/7z2605-x64.exe',
    'fd99e86f57d8f429ef5ed045bf98315af962e2309b0f1ba87a147a44c71647d0',
  ],
  [
    'vcxsrv-source.tar.gz',
    `https://codeload.github.com/marchaesen/vcxsrv/tar.gz/${commit}`,
    'a73b30db3eb6b60efd181a1cd7fa39bc6df8f0d4c973d6c8416a856b0bf55b28',
  ],
  [
    'COPYING',
    `https://raw.githubusercontent.com/marchaesen/vcxsrv/${commit}/COPYING`,
    '0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b',
  ],
]
async function asset([name, url, hash]) {
  const file = path.join(cache, name)
  let data = await fs.readFile(file).catch(() => undefined)
  if (!data) {
    console.log(`Downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)
    data = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(data).digest('hex') !== hash)
    throw new Error(`SHA256 mismatch: ${name}`)
  await fs.writeFile(file, data)
}
async function find7za() {
  if (process.env.SEVEN_ZIP_PATH) return process.env.SEVEN_ZIP_PATH
  const direct = 'C:/Program Files/7-Zip/7z.exe'
  if (
    await fs.access(direct).then(
      () => true,
      () => false,
    )
  )
    return direct
  const builder = path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/7zip@1.0.0')
  for (const entry of await fs.readdir(builder).catch(() => [])) {
    const candidate = path.join(builder, entry, 'bin/7za.exe')
    if (
      await fs.access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate
  }
  throw new Error(
    'Set SEVEN_ZIP_PATH to a local 7z.exe/7za.exe (or run the existing electron-builder native preparation once).',
  )
}
function extract(executable, input, output) {
  const result = spawnSync(executable, ['x', input, `-o${output}`, '-y'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Archive extraction failed: ${input}`)
}
async function main() {
  if (process.platform !== 'win32') throw new Error('VcXsrv preparation requires Windows.')
  const prepared = await fs
    .readFile(path.join(destination, 'upstream.json'), 'utf8')
    .then(JSON.parse, () => undefined)
  if (
    prepared?.commit === commit &&
    (await Promise.all(
      [
        path.join(destination, 'vcxsrv.exe'),
        path.join(destination, 'COPYING'),
        path.join(destination, 'NOTICE.txt'),
        path.join(source, 'vcxsrv-21.1.16.1-source.tar.gz'),
      ].map((file) =>
        fs.access(file).then(
          () => true,
          () => false,
        ),
      ),
    ).then((values) => values.every(Boolean)))
  ) {
    console.log('Managed X11 runtime and corresponding source are already prepared.')
    return
  }
  await fs.mkdir(cache, { recursive: true })
  for (const entry of assets) await asset(entry)
  const bootstrap = await find7za()
  const tools = path.join(cache, '7zip')
  extract(bootstrap, path.join(cache, '7zip.exe'), tools)
  extract(path.join(tools, '7z.exe'), path.join(cache, 'vcxsrv.exe'), destination)
  // Remove the upstream localhost bypass list and installer-only tools.
  for (const name of [
    '$PLUGINSDIR',
    'X0.hosts',
    'uninstall.exe',
    'plink.exe',
    'xhost.exe',
    'xlaunch.exe',
  ]) {
    const target = path.resolve(destination, name)
    if (path.dirname(target) !== destination) throw new Error('Unsafe extraction cleanup path')
    await fs.rm(target, { force: true, recursive: true })
  }
  await fs.mkdir(source, { recursive: true })
  await fs.copyFile(
    path.join(cache, 'vcxsrv-source.tar.gz'),
    path.join(source, 'vcxsrv-21.1.16.1-source.tar.gz'),
  )
  await fs.copyFile(path.join(cache, 'COPYING'), path.join(destination, 'COPYING'))
  await fs.copyFile(path.join(root, 'native/x11/NOTICE.txt'), path.join(destination, 'NOTICE.txt'))
  await fs.writeFile(
    path.join(destination, 'upstream.json'),
    JSON.stringify(
      { version: '21.1.16.1', commit, assets: assets.filter(([name]) => !name.startsWith('7zip')) },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'Managed X11 runtime ready. Native executable is unmodified; upstream source and licenses are included.',
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
