import type { ElectronApplication } from '@playwright/test'
export async function allowClosing(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox
  })
}
