// @vitest-environment jsdom
import { it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { HostEditor } from '../../src/renderer/src/features/hosts/HostEditor'
import { filterHosts } from '../../src/renderer/src/features/hosts/useHosts'
import type { HostProfile } from '../../src/shared/contracts'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('uses the last successful login only for new profiles and keeps later edits', async () => {
  let resolveSettings!: (settings: { lastUsername: string }) => void
  const get = vi.fn(
    () =>
      new Promise<{ lastUsername: string }>((resolve) => {
        resolveSettings = resolve
      }),
  )
  Object.assign(window, { terminalApi: { settings: { get } } })
  const view = render(
    createElement(HostEditor, { quick: true, onClose: () => {}, onSave: async () => {} }),
  )
  fireEvent.change(screen.getByLabelText('Пользователь'), { target: { value: 'typed-first' } })
  resolveSettings({ lastUsername: 'shvv' })
  await waitFor(() => expect(get).toHaveBeenCalledOnce())
  expect((screen.getByLabelText('Пользователь') as HTMLInputElement).value).toBe('typed-first')
  view.unmount()
  get.mockImplementation(async () => ({ lastUsername: 'shvv' }))
  const next = render(createElement(HostEditor, { onClose: () => {}, onSave: async () => {} }))
  await waitFor(() =>
    expect((screen.getByLabelText('Пользователь') as HTMLInputElement).value).toBe('shvv'),
  )
  next.unmount()
  render(createElement(HostEditor, { profile, onClose: () => {}, onSave: async () => {} }))
  expect((screen.getByLabelText('Пользователь') as HTMLInputElement).value).toBe('admin')
})
const profile: HostProfile = {
  id: 'c8019a9d-5f81-4836-8b97-cb6c44b19c1d',
  name: 'Production',
  protocol: 'ssh',
  host: '10.0.0.2',
  port: 22,
  username: 'admin',
  auth: 'password',
  group: 'Linux',
  favorite: false,
  monitoringEnabled: true,
}
it('filtersNameAddressAndGroup', () => {
  expect(filterHosts([profile], 'PROD', false)).toHaveLength(1)
  expect(filterHosts([profile], '10.0.', false)).toHaveLength(1)
  expect(filterHosts([profile], 'linux', false)).toHaveLength(1)
  expect(filterHosts([profile], '', true)).toEqual([])
})
it('switchProtocolDropsInvalidNetworkFields', async () => {
  let saved: HostProfile | undefined
  render(
    createElement(HostEditor, {
      profile,
      onClose: () => {},
      onSave: async (value) => {
        saved = value
      },
    }),
  )
  fireEvent.change(screen.getByLabelText('Протокол'), { target: { value: 'telnet' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить', exact: true }))
  await waitFor(() => expect(saved?.protocol).toBe('telnet'))
  expect(saved).not.toHaveProperty('username')
  expect(saved).not.toHaveProperty('monitoringEnabled')
  expect(saved).not.toHaveProperty('keyPath')
})
it('doesNotSavePasswordWhenCreatingHostProfile', async () => {
  const secrets: (string | undefined)[] = []
  render(
    createElement(HostEditor, {
      profile,
      onClose: () => {},
      onSave: async (_value, secret) => {
        secrets.push(secret)
      },
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить', exact: true }))
  await waitFor(() => expect(secrets.length).toBe(1))
  expect(secrets[0]).toBeUndefined()
})
it('doesNotAskWhetherToEnableMonitoringForEachHost', () => {
  render(createElement(HostEditor, { profile, onClose: () => {}, onSave: async () => {} }))
  expect(screen.queryByLabelText('Мониторинг Linux')).toBeNull()
})
it('does not create saved credentials automatically for a server', async () => {
  const saveIdentity = vi.fn(),
    saveHost = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('terminalApi', undefined)
  Object.assign(window, {
    terminalApi: {
      identities: { list: async () => [], discoverSsh: async () => [], save: saveIdentity },
    },
  })
  render(createElement(HostEditor, { profile, onClose: () => {}, onSave: saveHost }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить', exact: true }))
  await waitFor(() => expect(saveHost).toHaveBeenCalled())
  expect(saveIdentity).not.toHaveBeenCalled()
  expect(saveHost.mock.calls[0][0].identityId).toBeUndefined()
})
it('uses a saved login and blocks accidental shared password edits in the server form', async () => {
  const saveHost = vi.fn().mockResolvedValue(undefined),
    id = 'bd658b1c-1c55-4d13-b51b-3477079098f1'
  Object.assign(window, {
    terminalApi: {
      identities: {
        list: async () => [{ id, name: 'Компания', method: 'password', username: 'shared' }],
        discoverSsh: async () => [],
      },
    },
  })
  render(
    createElement(HostEditor, {
      profile: { ...profile, identityId: id } as HostProfile,
      onClose: () => {},
      onSave: saveHost,
    }),
  )
  await waitFor(() =>
    expect((screen.getByLabelText('Пользователь') as HTMLInputElement).value).toBe('shared'),
  )
  expect((screen.getByLabelText('Пользователь') as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByLabelText('Пароль', { selector: 'input' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить', exact: true }))
  await waitFor(() => expect(saveHost).toHaveBeenCalled())
  expect(saveHost.mock.calls[0][0]).toMatchObject({ identityId: id, username: 'shared' })
  expect(saveHost.mock.calls[0][1]).toBeUndefined()
})
