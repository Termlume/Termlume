// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HostProfile } from '../../src/shared/contracts'
import { filterHosts } from '../../src/renderer/src/features/hosts/useHosts'
import { HostList } from '../../src/renderer/src/features/hosts/HostList'
import { Sidebar } from '../../src/renderer/src/app/Sidebar'
afterEach(cleanup)
const hosts: HostProfile[] = [
  {
    id: '1',
    name: 'Database',
    protocol: 'wsl',
    distribution: 'Ubuntu',
    group: '',
    favorite: true,
    color: '#ffffff',
    tags: ['Prod', 'db', 'my-prod'],
  },
  {
    id: '2',
    name: 'Other',
    protocol: 'wsl',
    distribution: 'Ubuntu',
    group: 'Без группы',
    favorite: false,
    color: '#ffffff',
    tags: ['production'],
  },
]
it('intersects exact tags, text and favorites, and includes tags in ordinary search', () => {
  expect(filterHosts(hosts, '#PROD #db data', true).map((host) => host.id)).toEqual(['1'])
  expect(filterHosts(hosts, '#prod other', false)).toEqual([])
  expect(filterHosts(hosts, '#my-prod', false).map((host) => host.id)).toEqual(['1'])
  expect(filterHosts(hosts, 'production', false).map((host) => host.id)).toEqual(['2'])
  expect(filterHosts(hosts, '#production', true)).toEqual([])
})
it('keeps unnamed group separate and temporarily expands search without changing saved state', () => {
  const onConnect = vi.fn(),
    onTag = vi.fn(),
    onToggleGroup = vi.fn()
  const props = {
    hosts,
    onConnect,
    onTag,
    onToggleGroup,
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onFavorite: vi.fn(),
    collapsedGroups: [''],
  }
  const view = render(<HostList {...props} />)
  expect(screen.queryByRole('button', { name: 'Подключиться: Database' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Подключиться: Other' })).toBeTruthy()
  view.rerender(<HostList {...props} searchActive />)
  fireEvent.click(screen.getAllByRole('button', { name: /Без группы/ })[0])
  fireEvent.click(screen.getByRole('button', { name: '#Prod' }))
  expect(onTag).toHaveBeenCalledWith('Prod')
  expect(onConnect).not.toHaveBeenCalled()
  expect(onToggleGroup).not.toHaveBeenCalled()
  view.rerender(<HostList {...props} />)
  expect(screen.queryByRole('button', { name: 'Подключиться: Database' })).toBeNull()
})
it('temporarily expands all connections and provides explicit search reset', () => {
  const onSearch = vi.fn(),
    onToggleConnections = vi.fn()
  const props = { onNew: vi.fn(), connectionsCollapsed: true, onSearch, onToggleConnections }
  const view = render(
    <Sidebar {...props}>
      <span>host content</span>
    </Sidebar>,
  )
  expect(screen.queryByText('host content')).toBeNull()
  view.rerender(
    <Sidebar {...props} search="#prod">
      <span>host content</span>
    </Sidebar>,
  )
  expect(screen.getByText('host content')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Все подключения' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить поиск' }))
  expect(onSearch).toHaveBeenCalledWith('')
  expect(onToggleConnections).not.toHaveBeenCalled()
})
