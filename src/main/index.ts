import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Backend } from './Backend'
import { autoUpdater } from 'electron-updater'
import { UpdateService } from './updates/UpdateService'
import { registerApi } from './ipc/register'
import { SettingsRepository } from './storage/SettingsRepository'
import { DataImportTransaction } from './storage/DataImportTransaction'
import { resolveUserDataPath } from './storage/user-data-path'
import { WINDOWS_APP_USER_MODEL_ID } from './platform/app-identity'
import { shouldRelayShortcut } from './keyboard-shortcut'
import { getTheme } from '../renderer/src/themes/palettes'
import type { Settings, ThemeId } from '../shared/contracts'

const dataArg = process.argv.find((arg) => arg.startsWith('--user-data-dir='))
let cleanup: Promise<void> = Promise.resolve()
app.setPath(
  'userData',
  resolveUserDataPath(app.getPath('appData'), dataArg?.slice('--user-data-dir='.length)),
)

async function createWindow(): Promise<void> {
  try {
    await DataImportTransaction.recover(app.getPath('userData'))
  } catch (error) {
    dialog.showErrorBox(
      'Termlume — восстановление данных',
      `Не удалось безопасно завершить восстановление импорта. Данные не будут загружены. Проверьте резервные копии в папке данных приложения.\n\n${String(error)}`,
    )
    app.quit()
    return
  }
  const dev = process.env.ELECTRON_RENDERER_URL
  const settings = await new SettingsRepository(join(app.getPath('userData'), 'settings.json'))
    .get()
    .catch(() => undefined)
  const initialTheme = getTheme(settings?.themeId || 'catppuccin-mocha')
  nativeTheme.themeSource = initialTheme.light ? 'light' : 'dark'
  const win = new BrowserWindow({
    width: settings?.windowBounds.width || 1440,
    height: settings?.windowBounds.height || 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Termlume',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: initialTheme.colors.panel,
      symbolColor: initialTheme.colors.text,
      height: 32,
    },
    backgroundColor: initialTheme.colors.bg,
    backgroundMaterial: 'mica',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const applyWindowTheme = (id: ThemeId) => {
    const theme = getTheme(id)
    nativeTheme.themeSource = theme.light ? 'light' : 'dark'
    if (!win.isDestroyed()) {
      win.setBackgroundColor(theme.colors.bg)
      if (process.platform === 'win32')
        win.setTitleBarOverlay({
          color: theme.colors.panel,
          symbolColor: theme.colors.text,
          height: 32,
        })
    }
  }
  let shortcutBindings = settings?.shortcutBindings
  const handleBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (!shouldRelayShortcut(input, shortcutBindings)) return
    event.preventDefault()
    win.webContents.send('terminal:shortcut', {
      key: input.key,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
    })
  }
  win.webContents.on('before-input-event', handleBeforeInput)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const fileProgress = new Map<string, import('../shared/contracts').FileActivity>()
  const backend = new Backend(
    app.getPath('userData'),
    win.webContents.id,
    (event) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('terminal:event', event)
    },
    (entry) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('terminal:transfer', entry)
    },
    (event) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('terminal:metric', event)
    },
    (message) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('terminal:notice', message)
    },
    async (summary) => {
      if (win.isDestroyed()) return true
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Termlume',
        message: 'Завершить активные сеансы?',
        detail:
          'Подключений: ' +
          summary.sessions +
          '. Активных передач: ' +
          summary.transfers +
          '. Работающие сеансы будут закрыты, передачи остановлены.',
        buttons: ['Отмена', 'Завершить'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      return result.response === 1
    },
    (activity) => {
      if (win.webContents.isDestroyed()) return
      win.webContents.send('terminal:file-activity', activity)
      const key = activity.sessionId + ':' + activity.path
      if (activity.state === 'running') fileProgress.set(key, activity)
      else fileProgress.delete(key)
      const active = [...fileProgress.values()]
      win.setProgressBar(
        !active.length
          ? -1
          : active.some((item) => !item.total)
            ? 2
            : active.reduce((sum, item) => sum + item.completed, 0) /
              Math.max(
                1,
                active.reduce((sum, item) => sum + (item.total || 0), 0),
              ),
      )
    },
  )
  let closeAllowed = false,
    closeRequested = false
  const updates = new UpdateService(
    autoUpdater,
    {
      currentVersion: app.getVersion(),
      channel: settings?.updateChannel ?? 'prerelease',
      enabled:
        process.platform === 'win32' &&
        app.isPackaged &&
        !dev &&
        !dataArg &&
        existsSync(join(dirname(process.execPath), 'Uninstall Termlume.exe')),
    },
    (status) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('terminal:update-status', status)
    },
    async () => {
      const result = await backend.closer.requestWindowClose(win.webContents.id)
      if (result !== 'closed') return false
      cleanup = backend.close()
      await cleanup
      closeAllowed = true
      return true
    },
  )
  win.on('close', (event) => {
    if (closeAllowed) return
    event.preventDefault()
    if (closeRequested) return
    closeRequested = true
    void backend.closer
      .requestWindowClose(win.webContents.id)
      .then((result) => {
        if (result === 'closed' && !win.isDestroyed()) {
          closeAllowed = true
          win.close()
        }
      })
      .catch(() => {})
      .finally(() => {
        closeRequested = false
      })
  })
  win.webContents.on('render-process-gone', () => {
    void backend.close()
    win.destroy()
  })
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  win.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized()) {
        const { width, height } = win.getBounds()
        void backend.settings.update({ windowBounds: { width, height } }).catch(() => {})
      }
    }, 200)
  })
  win.on('minimize', () => backend.monitoring.setWindowVisible(false))
  win.on('hide', () => backend.monitoring.setWindowVisible(false))
  win.on('restore', () => backend.monitoring.setWindowVisible(true))
  win.on('show', () => backend.monitoring.setWindowVisible(true))
  const unregister = registerApi(
    win,
    async (request) => {
      if (request.action === 'updates.status') return updates.status()
      if (request.action === 'updates.check') return updates.check()
      if (request.action === 'updates.download') return updates.download()
      if (request.action === 'updates.install') return updates.install()
      const result =
        request.action === 'settings.update' && request.patch.updateChannel !== undefined
          ? await updates.changeChannel(
              request.patch.updateChannel,
              () => backend.handle(request) as Promise<Settings>,
            )
          : request.action === 'data.commitImport'
            ? await updates.changeChannel(
                undefined,
                () => backend.handle(request) as Promise<Settings>,
              )
            : await backend.handle(request)
      if (request.action === 'settings.update' || request.action === 'data.commitImport') {
        const current = await backend.settings.get()
        shortcutBindings = current.shortcutBindings
        applyWindowTheme(current.themeId)
      }
      return result
    },
    dev || pathToFileURL(join(__dirname, '../renderer/index.html')).href,
    (token, sender) => backend.beginExternalDrag(token, sender),
    applyWindowTheme,
  )
  win.on('closed', () => {
    updates.dispose()
    if (resizeTimer) clearTimeout(resizeTimer)
    unregister()
    cleanup = backend.close()
  })
  const blockNavigation = (event: Electron.Event) => {
    event.preventDefault()
  }
  win.webContents.on('will-navigate', blockNavigation)
  win.webContents.on('will-frame-navigate', blockNavigation)
  win.webContents.on('will-redirect', blockNavigation)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'" +
            (dev ? " 'unsafe-inline'" : '') +
            "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'" +
            (dev ? ' http://localhost:* ws://localhost:*' : '') +
            "; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ],
      },
    }),
  )
  win.once('ready-to-show', () => win.show())
  if (dev) await win.loadURL(dev)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))
  updates.scheduleChecks()
}
app.whenReady().then(() => {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  return createWindow()
})
app.on('window-all-closed', () => {
  void cleanup.finally(() => app.quit())
})
