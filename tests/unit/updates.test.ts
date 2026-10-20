import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { UpdateService } from '../../src/main/updates/UpdateService'
import { CloseCoordinator } from '../../src/main/lifecycle/close-coordinator'
import { settingsSchema, settingsPatchSchema } from '../../src/shared/schemas'

function setup(
  channel: 'stable' | 'prerelease' = 'stable',
  enabled = true,
  prepare = async () => true,
) {
  const driver = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  })
  const service = new UpdateService(
    driver as unknown as ConstructorParameters<typeof UpdateService>[0],
    {
      currentVersion: '0.1.0-alpha.1',
      channel,
      enabled,
    },
    vi.fn(),
    prepare,
  )
  return { driver, service }
}
it('stable excludes all prereleases even from alpha; opt-in accepts stable without enabling downgrades', async () => {
  const { driver, service } = setup()
  expect(driver.allowPrerelease).toBe(false)
  expect(driver.allowDowngrade).toBe(false)
  expect(driver.autoDownload).toBe(false)
  expect(driver.autoInstallOnAppQuit).toBe(false)
  driver.checkForUpdates.mockImplementation(async () => {
    driver.emit('update-available', { version: '0.2.0-alpha.2' })
    return null
  })
  expect((await service.check()).state).toBe('not-available')
  await expect(service.download()).rejects.toThrow()
  await service.changeChannel('prerelease', async () =>
    settingsSchema.parse({ updateChannel: 'prerelease' }),
  )
  expect(driver.allowPrerelease).toBe(true)
  expect(driver.allowDowngrade).toBe(false)
  expect(driver.setFeedURL).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'beta' }))
  driver.checkForUpdates.mockImplementation(async () => {
    driver.emit('update-available', { version: '0.2.0' })
    return null
  })
  expect((await service.check()).state).toBe('available')
  expect(service.status().version).toBe('0.2.0')
  expect(settingsPatchSchema.parse({})).toEqual({})
  expect(settingsSchema.parse({}).updateChannel).toBe('stable')
  service.dispose()
})
it('locks channel while checking and prevents stale progress after channel switch', async () => {
  const { driver, service } = setup()
  let finish!: () => void
  driver.checkForUpdates.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        finish = () => {
          driver.emit('update-available', { version: '0.2.0' })
          resolve(null)
        }
      }),
  )
  const checking = service.check()
  const persist = vi.fn(async () => settingsSchema.parse({ updateChannel: 'prerelease' }))
  await expect(service.changeChannel('prerelease', persist)).rejects.toThrow('завершения')
  expect(persist).not.toHaveBeenCalled()
  finish()
  await checking
  await service.changeChannel('prerelease', persist)
  driver.emit('download-progress', { percent: 99 })
  driver.emit('update-downloaded', { version: '0.2.0' })
  expect(service.status()).toMatchObject({ state: 'idle', channel: 'prerelease' })
  service.dispose()
})
it('installation waits for CloseCoordinator confirmation and cleanup; cancellation keeps update', async () => {
  let accepted = false
  const order: string[] = []
  const closer = new CloseCoordinator(
    () => ({ sessions: 1, transfers: 1 }),
    async () => accepted,
    async () => {
      await Promise.resolve()
      order.push('cleaned')
    },
    async () => {},
  )
  const { driver, service } = setup(
    'stable',
    true,
    async () => (await closer.requestWindowClose(1)) === 'closed',
  )
  driver.checkForUpdates.mockImplementation(async () => {
    driver.emit('update-available', { version: '0.2.0' })
    return null
  })
  driver.downloadUpdate.mockImplementation(async () => {
    driver.emit('update-downloaded', { version: '0.2.0' })
    return []
  })
  driver.quitAndInstall.mockImplementation(() => {
    order.push('install')
  })
  await service.check()
  await service.download()
  await service.install()
  expect(service.status().state).toBe('downloaded')
  expect(order).toEqual([])
  accepted = true
  await service.install()
  expect(order).toEqual(['cleaned', 'install'])
  expect(driver.quitAndInstall).toHaveBeenCalledWith(false, true)
  service.dispose()
  const disabled = setup('stable', false)
  expect((await disabled.service.check()).state).toBe('disabled')
  expect(disabled.driver.checkForUpdates).not.toHaveBeenCalled()
  disabled.service.dispose()
})

it('first public alpha reports no stable release but preserves manifest, auth and network errors', async () => {
  const { driver, service } = setup()
  const failures = [
    {
      code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
      message: 'Unable to find latest version: HttpError: 404 Not Found',
      missing: true,
    },
    {
      code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
      message: 'No published versions on GitHub',
      missing: true,
    },
    {
      code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
      message: 'Cannot find latest.yml: 404 Not Found',
      missing: false,
    },
    {
      code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
      message: 'Unable to find latest version: HttpError: 403 Forbidden',
      missing: false,
    },
    {
      code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
      message: 'Unable to find latest version: ECONNRESET',
      missing: false,
    },
  ]
  for (const failure of failures) {
    driver.checkForUpdates.mockImplementation(async () => {
      throw Object.assign(new Error(failure.message), { code: failure.code })
    })
    const result = await service.check()
    expect(result.state).toBe(failure.missing ? 'not-available' : 'error')
    if (failure.missing) expect(result.message).toBe('Стабильных выпусков пока нет')
    else expect(result.error).toBe(failure.message)
  }
  await service.changeChannel('prerelease', async () =>
    settingsSchema.parse({ updateChannel: 'prerelease' }),
  )
  driver.checkForUpdates.mockImplementation(async () => {
    throw Object.assign(new Error('No releases'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' })
  })
  expect((await service.check()).state).toBe('error')
  service.dispose()
})
it('confirms absent stable release through API when GitHub latest endpoint returns 406', async () => {
  const { driver, service } = setup()
  const request = vi.fn(async () => ({ status: 404 }))
  vi.stubGlobal('fetch', request)
  try {
    driver.checkForUpdates.mockImplementation(async () => {
      throw Object.assign(
        new Error('Unable to find latest version on GitHub: HttpError: 406 Not Acceptable'),
        {
          code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
        },
      )
    })
    expect(await service.check()).toMatchObject({
      state: 'not-available',
      message: 'Стабильных выпусков пока нет',
    })
    expect(request).toHaveBeenCalledOnce()
    request.mockResolvedValue({ status: 403 })
    expect((await service.check()).state).toBe('error')
  } finally {
    vi.unstubAllGlobals()
    service.dispose()
  }
})

it('handles the real GitHubProvider wrapper around the missing stable endpoint', async () => {
  const { driver, service } = setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status: 404 })),
  )
  try {
    driver.checkForUpdates.mockImplementation(async () => {
      const error = Object.assign(
        new Error(
          'Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/Termlume/Termlume/releases/latest), please ensure a production release exists: HttpError: 406 Not Acceptable,\nXML:\n<feed/>',
        ),
        { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' },
      )
      driver.emit('error', error)
      throw error
    })
    expect(await service.check()).toMatchObject({
      state: 'not-available',
      message: 'Стабильных выпусков пока нет',
      error: undefined,
    })
    vi.mocked(fetch).mockResolvedValue({ status: 403 } as Response)
    expect((await service.check()).state).toBe('error')
  } finally {
    vi.unstubAllGlobals()
    service.dispose()
  }
})
it('checks after startup and each hour, and stops checking after disposal', async () => {
  vi.useFakeTimers()
  const { driver, service } = setup('prerelease')
  driver.checkForUpdates.mockImplementation(async () => {
    driver.emit('update-available', { version: '0.2.0-alpha.2' })
    return null
  })
  try {
    service.scheduleChecks()
    service.scheduleChecks()
    await vi.advanceTimersByTimeAsync(9999)
    expect(service.status().state).toBe('idle')
    await vi.advanceTimersByTimeAsync(1)
    expect(service.status()).toMatchObject({ state: 'available', version: '0.2.0-alpha.2' })
    driver.checkForUpdates.mockImplementation(async () => {
      driver.emit('update-available', { version: '0.2.0-alpha.3' })
      return null
    })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 10000)
    expect(service.status().version).toBe('0.2.0-alpha.3')
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
    service.dispose()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
  } finally {
    service.dispose()
    vi.useRealTimers()
  }
})

it('keeps a downloaded update ready through scheduled and manual checks', async () => {
  vi.useFakeTimers()
  const { driver, service } = setup('prerelease')
  driver.checkForUpdates.mockImplementation(async () => {
    driver.emit('update-available', { version: '0.2.0-alpha.2', releaseNotes: 'Fixes' })
    return null
  })
  driver.downloadUpdate.mockImplementation(async () => {
    driver.emit('update-downloaded', { version: '0.2.0-alpha.2', releaseNotes: 'Fixes' })
    return []
  })
  try {
    service.scheduleChecks()
    await vi.advanceTimersByTimeAsync(10000)
    await service.download()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(await service.check()).toMatchObject({
      state: 'downloaded',
      version: '0.2.0-alpha.2',
      releaseNotes: 'Fixes',
    })
    expect(driver.checkForUpdates).toHaveBeenCalledOnce()
    expect(driver.downloadUpdate).toHaveBeenCalledOnce()
  } finally {
    service.dispose()
    vi.useRealTimers()
  }
})
