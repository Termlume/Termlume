const { execFileSync } = require('node:child_process')
const version = require('../package.json').version
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/.test(version) || tag !== `v${version}`)
  throw new Error('Release tag must match package.json (stable, alpha.N or beta.N)')
const branch = version.includes('-') ? 'preview' : 'main'
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${branch}`], {
  stdio: 'inherit',
  windowsHide: true,
})
console.log(`Release ${tag} verified against ${branch}`)
