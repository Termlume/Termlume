// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { HostEditor } from '../../src/renderer/src/features/hosts/HostEditor'
import { filterHosts } from '../../src/renderer/src/features/hosts/useHosts'
import type { HostProfile } from '../../src/shared/contracts'
afterEach(cleanup)
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
