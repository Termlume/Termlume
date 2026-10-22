// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WslDistributionSelect } from '../../src/renderer/src/features/hosts/WslDistributionSelect'

afterEach(cleanup)
it('selects the installed Windows default and lets a new connection choose another distribution', async () => {
  const inventory = vi.fn(async () => [
    { name: 'Ubuntu', isDefault: false, state: 'Stopped', version: 2 },
    { name: 'Debian', isDefault: true, state: 'Running', version: 2 },
  ])
  Object.assign(window, { terminalApi: { wsl: { inventory } } })
  const onChange = vi.fn()
  render(createElement(WslDistributionSelect, { value: '', onChange }))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('Debian'))
  fireEvent.change(screen.getByLabelText('Дистрибутив WSL'), { target: { value: 'Ubuntu' } })
  expect(onChange).toHaveBeenLastCalledWith('Ubuntu')
  fireEvent.click(screen.getByText('Обновить список WSL'))
  await waitFor(() => expect(inventory).toHaveBeenCalledTimes(2))
})
it('keeps a missing saved distribution visible and blocks submitting it', async () => {
  Object.assign(window, { terminalApi: { wsl: { inventory: async () => [] } } })
  render(createElement(WslDistributionSelect, { value: 'Removed', onChange: vi.fn() }))
  await screen.findByText('Выбранный дистрибутив больше не установлен. Выберите другой.')
  expect((screen.getByLabelText('Дистрибутив WSL') as HTMLSelectElement).checkValidity()).toBe(
    false,
  )
  expect(screen.getByText('Removed — не установлен')).toBeTruthy()
})
