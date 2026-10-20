import { it, expect } from 'vitest'
import {
  parseCpu,
  cpuUsage,
  parseMemory,
  parseNetwork,
  networkRates,
  parseDisks,
  parseUptime,
} from '../../src/main/monitoring/linux-parsers'
it('firstSampleHasNoCpuOrNetworkRate', () => {
  expect(cpuUsage(parseCpu('cpu 10 0 5 80 5 0 0 0 4 0'), undefined)).toBeUndefined()
  expect(networkRates({ eth0: { rx: 100, tx: 200 } }, undefined, 3)).toBeUndefined()
  expect(
    cpuUsage(parseCpu('cpu 20 0 10 160 10 0 0 0 8 0'), parseCpu('cpu 10 0 5 80 5 0 0 0 4 0')),
  ).toBe(15)
})
it('memAvailableDefinesUsedRam', () => {
  const metrics = parseMemory(
    'MemTotal: 1000 kB\nMemFree: 20 kB\nMemAvailable: 400 kB\nSwapTotal: 100 kB\nSwapFree: 80 kB',
  )
  expect(metrics.ram).toEqual({ total: 1024000, available: 409600, used: 614400 })
  expect(metrics.swap?.used).toBe(20480)
  expect(parseMemory('MemTotal: 1000 kB\nMemFree: 20 kB').ram).toBeUndefined()
})
it('networkResetStartsNewBaseline and interfaceChurnNeverProducesNegativeRate', () => {
  expect(
    networkRates({ eth0: { rx: 5, tx: 6 } }, { eth0: { rx: 100, tx: 200 } }, 3),
  ).toBeUndefined()
  expect(
    networkRates(
      { eth0: { rx: 400, tx: 800 }, new0: { rx: 1, tx: 2 }, lo: { rx: 9999, tx: 9999 } },
      { eth0: { rx: 100, tx: 200 }, lo: { rx: 0, tx: 0 } },
      3,
    ),
  ).toMatchObject({ rx: 100, tx: 200 })
  expect(parseNetwork('eth0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0')).toEqual({
    eth0: { rx: 10, tx: 20 },
  })
})
it('diskParserPreservesMountSpaces', () => {
  expect(
    parseDisks(
      'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 30 70 30% /data with spaces',
    )[0],
  ).toMatchObject({ mount: '/data with spaces', total: 102400, used: 30720, percent: 30 })
})
it('missingUptimeIsUnavailableInsteadOfZero', () => {
  expect(() => parseUptime('')).toThrow()
  expect(() => parseUptime('garbage')).toThrow()
})
