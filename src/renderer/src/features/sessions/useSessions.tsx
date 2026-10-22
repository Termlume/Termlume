import { useEffect, useRef, useState } from 'react'
import type {
  HostProfile,
  LocalShellProfile,
  SessionEvent,
  SessionProfile,
  SessionState,
} from '../../../../shared/contracts'
import { SessionOutputRouter } from '../terminal/SessionOutputRouter'
export interface SessionTab {
  id: string
  profile: SessionProfile
  state: SessionState
  error?: string
}
export function useSessions(onError: (message: string) => void) {
  const [tabs, setTabs] = useState<SessionTab[]>([]),
    [directories, setDirectories] = useState<Record<string, string>>({}),
    [active, setActive] = useState<string>(),
    [challenges, setChallenges] = useState<Extract<SessionEvent, { type: 'challenge' }>[]>([])
  const output = useRef(new SessionOutputRouter()).current,
    states = useRef(new Map<string, SessionState>()),
    closedSessions = useRef(new Set<string>())
  useEffect(
    () =>
      window.terminalApi.sessions.onEvent((event) => {
        if (event.type === 'cwd') {
          setDirectories((current) =>
            current[event.sessionId] === event.path
              ? current
              : { ...current, [event.sessionId]: event.path },
          )
          return
        }
        if (event.type === 'data') {
          output.push(event.sessionId, event.data, event.sequence)
          return
        }
        if (event.type === 'state') {
          states.current.set(event.sessionId, event.state)
          setTabs((current) =>
            current.map((tab) =>
              tab.id === event.sessionId ? { ...tab, state: event.state } : tab,
            ),
          )
          if (['error', 'disconnected', 'closing'].includes(event.state))
            setChallenges((current) => current.filter((item) => item.sessionId !== event.sessionId))
        }
        if (event.type === 'error')
          setTabs((current) =>
            current.map((tab) =>
              tab.id === event.sessionId
                ? { ...tab, error: event.error.message, state: 'error' }
                : tab,
            ),
          )
        if (event.type === 'challenge')
          setChallenges((current) => [
            ...current.filter((item) => item.challenge.id !== event.challenge.id),
            event,
          ])
        if (event.type === 'closed') {
          setDirectories((current) => {
            const next = { ...current }
            delete next[event.sessionId]
            return next
          })
          closedSessions.current.add(event.sessionId)
          setChallenges((current) => current.filter((item) => item.sessionId !== event.sessionId))
          setTabs((current) => {
            const rest = current.filter((tab) => tab.id !== event.sessionId)
            setActive((value) => (value === event.sessionId ? rest.at(-1)?.id : value))
            return rest
          })
          output.remove(event.sessionId)
          states.current.delete(event.sessionId)
        }
      }),
    [output],
  )
  async function open(profile: HostProfile, temporary = false, secret?: string) {
    try {
      const id = temporary
        ? await window.terminalApi.sessions.openTemporary(profile, secret)
        : await window.terminalApi.sessions.open(profile.id)
      addTab(id, profile)
    } catch (error) {
      onError(String(error))
    }
  }
  function addTab(id: string, profile: SessionProfile) {
    if (closedSessions.current.has(id)) return
    setTabs((current) => [
      ...current,
      { id, profile, state: states.current.get(id) || 'connecting' },
    ])
    setActive(id)
  }
  async function openLocal(shell: LocalShellProfile['shell']) {
    try {
      const id = await window.terminalApi.sessions.openLocal(shell)
      addTab(id, {
        protocol: 'local',
        shell,
        name: shell === 'powershell' ? 'PowerShell' : 'Command Prompt',
      })
    } catch (error) {
      onError(String(error))
    }
  }
  async function reconnect(profile: SessionProfile) {
    if (profile.protocol === 'local') return openLocal(profile.shell)
    return open(profile)
  }
  async function close(id: string) {
    if ((await window.terminalApi.sessions.close(id)) === 'canceled') return
    setTabs((current) => {
      const rest = current.filter((tab) => tab.id !== id)
      setActive((value) => (value === id ? rest.at(-1)?.id : value))
      return rest
    })
    setChallenges((current) => current.filter((item) => item.sessionId !== id))
    output.remove(id)
    setDirectories((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    states.current.delete(id)
  }
  return {
    directories,
    tabs,
    active,
    setActive,
    open,
    openLocal,
    reconnect,
    close,
    output,
    challenges,
    setChallenges,
  }
}
