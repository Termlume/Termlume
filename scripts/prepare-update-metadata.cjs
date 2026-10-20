const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
module.exports = function prepareUpdateMetadata(folder, version) {
  const manifests = fs.readdirSync(folder).filter((name) => /^(latest|alpha|beta)\.yml$/.test(name))
  if (!manifests.length) throw new Error('No updater manifest was generated')
  const preferred = version.includes('-alpha.')
    ? 'alpha.yml'
    : version.includes('-beta.')
      ? 'beta.yml'
      : 'latest.yml'
  const content = fs.readFileSync(
    path.join(folder, manifests.includes(preferred) ? preferred : manifests[0]),
    'utf8',
  )
  if (!content.includes(`version: ${version}`)) throw new Error('Updater manifest version mismatch')
  for (const name of ['latest.yml', 'alpha.yml', 'beta.yml'])
    fs.writeFileSync(path.join(folder, name), content)
  const artifacts = fs
    .readdirSync(folder)
    .filter((name) => /\.(exe|blockmap|yml)$/.test(name))
    .sort()
  const sums = artifacts.map(
    (name) =>
      `${crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(folder, name)))
        .digest('hex')}  ${name}`,
  )
  fs.writeFileSync(path.join(folder, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
}
