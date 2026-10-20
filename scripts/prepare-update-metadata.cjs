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
  let content = fs.readFileSync(
    path.join(folder, manifests.includes(preferred) ? preferred : manifests[0]),
    'utf8',
  )
  if (!content.includes(`version: ${version}`)) throw new Error('Updater manifest version mismatch')
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')
  if (fs.existsSync(changelogPath)) {
    const lines = fs
      .readFileSync(changelogPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
    const start = lines.findIndex((line) => line.trim() === `## ${version}`)
    if (start >= 0 && !/^releaseNotes:/m.test(content)) {
      const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
      const notes = lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join('\n')
        .trim()
      if (notes)
        content =
          content.trimEnd() +
          '\nreleaseNotes: |\n' +
          notes
            .split('\n')
            .map((line) => '  ' + line)
            .join('\n') +
          '\n'
    }
  }
  for (const name of ['latest.yml', 'alpha.yml', 'beta.yml'])
    fs.writeFileSync(path.join(folder, name), content)
  const artifacts = fs
    .readdirSync(folder)
    .filter((name) => /\.(exe|blockmap)$/.test(name) || /^(latest|alpha|beta)\.yml$/.test(name))
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
