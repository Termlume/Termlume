// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReleaseNotes } from '../../src/renderer/src/features/settings/ReleaseNotes'
import { requestSchema } from '../../src/shared/schemas'
afterEach(cleanup)
it('opens only web links through the application and renders no remote images or HTML', () => {
  const openUrl = vi.fn(async () => {})
  Object.assign(window, { terminalApi: { app: { openUrl } } })
  const view = render(
    <ReleaseNotes
      text={
        '## Исправления\n\n[Подробнее](https://github.com/Termlume/Termlume/releases)\n\n![tracking](https://example.com/pixel.png)\n\n<script>window.bad=true</script>\n\n[unsafe](javascript:alert)'
      }
    />,
  )
  fireEvent.click(screen.getByRole('link', { name: 'Подробнее' }))
  expect(openUrl).toHaveBeenCalledWith('https://github.com/Termlume/Termlume/releases')
  expect(view.container.querySelector('img, script')).toBeNull()
  expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull()
})
it('rejects file and executable URL protocols in the main-process request schema', () => {
  for (const url of [
    'file:///C:/Windows/system32/cmd.exe',
    'javascript:alert(1)',
    'ms-settings:windowsupdate',
  ])
    expect(requestSchema.safeParse({ action: 'app.openUrl', url }).success).toBe(false)
  expect(
    requestSchema.safeParse({ action: 'app.openUrl', url: 'https://github.com/Termlume' }).success,
  ).toBe(true)
})
