// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Credentials } from '../../src/renderer/src/features/settings/Credentials'
afterEach(cleanup)
function setup(onDirtyChange?: (dirty: boolean) => void) {
  const identity = { id: 'saved', name: 'Компания', username: 'admin', method: 'password' },
    other = { id: 'other', name: 'Другая', method: 'password' }
  const save = vi.fn(async () => identity),
    remove = vi.fn(async () => {})
  Object.assign(window, {
    terminalApi: {
      identities: { list: async () => [identity, other], save, remove },
      hosts: { list: async () => [{ id: 'host', name: 'Production', identityId: 'saved' }] },
    },
  })
  const view = render(<Credentials onDirtyChange={onDirtyChange} />)
  return { save, remove, view }
}
it('shows linked hosts and sends only the newly entered replacement secret', async () => {
  const { save } = setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  expect(screen.getByText('Production')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Изменить / переименовать' })).toBeNull()
  const password = screen.getByLabelText(/Новый пароль/) as HTMLInputElement
  expect(password.value).toBe('')
  fireEvent.change(password, { target: { value: 'new-secret' } })
  fireEvent.change(screen.getByLabelText('Название компании или произвольное имя'), {
    target: { value: 'ООО Новое имя' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить учётные данные' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'saved', name: 'ООО Новое имя' }),
      'new-secret',
    ),
  )
})
it('reports unsaved secret edits, cancellation and unmount to the settings shell', async () => {
  const onDirtyChange = vi.fn(),
    { view } = setup(onDirtyChange)
  await screen.findByRole('button', { name: /Компания.*admin/ })
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  fireEvent.change(screen.getByLabelText(/Новый пароль/), { target: { value: 'unsaved-secret' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Отменить изменения' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  fireEvent.change(screen.getByLabelText(/Новый пароль/), { target: { value: 'another-secret' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  view.unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  expect(onDirtyChange.mock.calls.every((call) => typeof call[0] === 'boolean')).toBe(true)
})
it('requires a separate explicit confirmation before merging duplicates', async () => {
  const { remove } = setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  fireEvent.click(screen.getByRole('button', { name: 'Заменить у серверов…' }))
  fireEvent.change(screen.getByLabelText('Новые учётные данные'), { target: { value: 'other' } })
  const submit = screen.getByRole('button', { name: 'Подтвердить замену' }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(submit)
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith('saved', { replacementId: 'other', confirmMerge: true }),
  )
})
it('filters by login and shows legacy profile login guidance in the selected detail', async () => {
  setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  fireEvent.change(screen.getByLabelText('Найти учётные данные'), { target: { value: 'admin' } })
  expect(screen.queryByRole('button', { name: /Другая/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('Найти учётные данные'), { target: { value: 'Другая' } })
  fireEvent.click(screen.getByRole('button', { name: /Другая/ }))
  expect(screen.getByText(/В старой записи логин хранится отдельно/)).toBeTruthy()
  expect((screen.getByLabelText('Логин') as HTMLInputElement).value).toBe('')
})
it('keeps the draft and secret when another entry is selected until edits are cancelled', async () => {
  const { save } = setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  fireEvent.change(screen.getByLabelText(/Новый пароль/), { target: { value: 'draft-secret' } })
  fireEvent.click(screen.getByRole('button', { name: /Другая/ }))
  expect(screen.getByRole('alert').textContent).toContain('Сохраните изменения')
  expect((screen.getByLabelText(/Новый пароль/) as HTMLInputElement).value).toBe('draft-secret')
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отменить изменения' }))
  fireEvent.click(screen.getByRole('button', { name: /Другая/ }))
  expect((screen.getByLabelText(/Новый пароль/) as HTMLInputElement).value).toBe('')
})
it('separates safe deletion from replacement and preserves host access through detach', async () => {
  const { remove } = setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  fireEvent.click(screen.getByRole('button', { name: 'Удалить запись…' }))
  expect(screen.queryByLabelText('Новые учётные данные')).toBeNull()
  expect(screen.getByText(/Их текущие логины, пароли и ключи сохранятся/)).toBeTruthy()
  expect(screen.getByText('Production')).toBeTruthy()
  const submit = screen.getByRole('button', {
    name: 'Удалить и сохранить вход',
  }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(submit)
  await waitFor(() => expect(remove).toHaveBeenCalledWith('saved', { detach: true }))
})
it('allows renaming legacy credentials without replacing the saved secret or host logins', async () => {
  const { save } = setup()
  await screen.findByRole('button', { name: /Компания.*admin/ })
  fireEvent.click(screen.getByRole('button', { name: /Другая/ }))
  fireEvent.change(screen.getByLabelText('Название компании или произвольное имя'), {
    target: { value: 'Новое имя' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить учётные данные' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'other', name: 'Новое имя' }),
      undefined,
    ),
  )
})
