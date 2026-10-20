const fs = require('node:fs')
const path = require('node:path')
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const output = path.resolve('build/licenses')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
let count = 0
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev || !fs.existsSync(location)) continue
  const pkgPath = path.join(location, 'package.json')
  if (!fs.existsSync(pkgPath)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const licenses = fs
    .readdirSync(location)
    .filter(
      (name) =>
        /^(licen[sc]e|copying|notice)(\.|$)/i.test(name) &&
        fs.statSync(path.join(location, name)).isFile(),
    )
  if (!licenses.length) continue
  const body = licenses
    .map((name) => fs.readFileSync(path.join(location, name), 'utf8'))
    .join('\n\n')
  fs.writeFileSync(
    path.join(output, (pkg.name + '-' + pkg.version).replace(/[^a-zA-Z0-9._-]/g, '_') + '.txt'),
    pkg.name + ' ' + pkg.version + '\n' + (pkg.license || '') + '\n\n' + body.trimEnd() + '\n',
  )
  count++
}
console.log('Collected runtime license documents:', count)
