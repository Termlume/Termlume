import { ipcMain, type BrowserWindow } from 'electron'
import { parseRequest, validateSender } from './validate'
import { safeError } from '../../shared/errors'
import type { Request } from '../../shared/schemas'
import { fileDragSchema, settingsSchema } from '../../shared/schemas'
import type { FileDragRequest } from '../../shared/contracts'
export function registerApi(
  win: BrowserWindow,
  handle: (request: Request) => unknown,
  expectedUrl: string,
  beginExternalDrag?: (
    request: FileDragRequest,
    sender: Electron.WebContents,
  ) => Promise<boolean | string>,
  setTheme?: (themeId: import('../../shared/contracts').ThemeId) => void,
): () => void {
  const channel = 'terminal:request'
  const listener = async (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    try {
      if (event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('forbidden')
      validateSender(event.senderFrame?.url, expectedUrl)
      return { ok: true, value: await handle(parseRequest(value)) }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }
  ipcMain.handle(channel, listener)
  const dragListener = async (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    try {
      if (
        !beginExternalDrag ||
        event.sender.id !== win.webContents.id ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error('forbidden')
      validateSender(event.senderFrame?.url, expectedUrl)
      return { ok: true, value: await beginExternalDrag(fileDragSchema.parse(value), event.sender) }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  }
  ipcMain.handle('terminal:begin-external-drag', dragListener)
  const themeListener = (event: Electron.IpcMainEvent, value: unknown) => {
    if (event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame)
      return
    try {
      validateSender(event.senderFrame?.url, expectedUrl)
      const parsed = settingsSchema.shape.themeId.removeDefault().safeParse(value)
      if (parsed.success) setTheme?.(parsed.data)
    } catch {}
  }
  ipcMain.on('terminal:theme', themeListener)
  return () => {
    ipcMain.removeListener('terminal:theme', themeListener)
    ipcMain.removeHandler(channel)
    ipcMain.removeHandler('terminal:begin-external-drag')
  }
}
