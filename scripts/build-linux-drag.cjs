const { spawnSync } = require('node:child_process')
const { mkdirSync, copyFileSync } = require('node:fs')
const { join } = require('node:path')
if (process.platform !== 'linux') process.exit(0)
const output = join(__dirname, '../native/linux-drag/bin')
mkdirSync(output, { recursive: true })
const flags = spawnSync('pkg-config', ['--cflags', '--libs', 'fuse3'], { encoding: 'utf8' })
if (flags.status !== 0)
  throw Error('Install libfuse3-dev and pkg-config to build Linux file drag support')
const result = spawnSync(
  'gcc',
  [
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    join(__dirname, '../native/linux-drag/main.c'),
    ...flags.stdout.trim().split(/\s+/),
    '-Wl,-rpath,$ORIGIN',
    '-o',
    join(output, 'termlume-file-drag'),
  ],
  { stdio: 'inherit' },
)
if (result.status !== 0) throw Error('Linux file drag helper build failed')

// Keep the ABI used at build time beside the helper. Debian and Ubuntu use
// different libfuse SONAMEs; the system fusermount3 utility remains native.
const dynamic = spawnSync('readelf', ['-d', join(output, 'termlume-file-drag')], { encoding: 'utf8' })
const soname = dynamic.stdout?.match(/\[(libfuse3\.so\.\d+)\]/)?.[1]
const libdir = spawnSync('pkg-config', ['--variable=libdir', 'fuse3'], { encoding: 'utf8' })
if (!soname || libdir.status !== 0) throw Error('Cannot locate the linked FUSE runtime')
copyFileSync(join(libdir.stdout.trim(), soname), join(output, soname))
copyFileSync('/usr/share/common-licenses/LGPL-2.1', join(output, 'FUSE-LGPL-2.1.txt'))
const fusePackage = spawnSync('dpkg-query', ['-S', `*/${soname}`], { encoding: 'utf8' })
const packageName = fusePackage.stdout.split(':')[0].trim()
if (fusePackage.status !== 0 || !packageName) throw Error('Cannot locate FUSE copyright information')
copyFileSync(`/usr/share/doc/${packageName}/copyright`, join(output, 'FUSE-copyright.txt'))
