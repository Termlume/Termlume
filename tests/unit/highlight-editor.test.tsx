// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { HighlightRulesEditor } from '../../src/renderer/src/features/settings/HighlightRulesEditor'
import { DEFAULT_HIGHLIGHT_RULES, type HighlightRule } from '../../src/shared/highlight-rules'
vi.mock('../../src/renderer/src/features/terminal/AsyncOutputHighlighter', () => ({
  AsyncOutputHighlighter: class {
    write() {}
    dispose() {}
  },
}))
afterEach(cleanup)
function Editor({
  initial = DEFAULT_HIGHLIGHT_RULES,
  changed = vi.fn(),
}: {
  initial?: HighlightRule[]
  changed?: (rules: HighlightRule[] | undefined) => void
}) {
  const [value, setValue] = useState<HighlightRule[] | undefined>(initial)
  return (
    <HighlightRulesEditor
      value={value}
      onChange={(rules) => {
        changed(rules)
        setValue(rules)
      }}
    />
  )
}
it('shows decoded words in one compact editor and updates simple conditions', () => {
  const changed = vi.fn()
  render(<Editor changed={changed} />)
  expect(screen.getAllByLabelText('Название')).toHaveLength(1)
  expect((screen.getByLabelText('Слова и фразы') as HTMLTextAreaElement).value).toBe(
    'ERROR\nFAILED',
  )
  expect(screen.queryByLabelText('Регулярное выражение')).toBeNull()
  fireEvent.change(screen.getByLabelText('Слова и фразы'), { target: { value: 'a.b\nfailed' } })
  fireEvent.change(screen.getByLabelText('Условие'), { target: { value: 'starts' } })
  expect(changed.mock.lastCall?.[0][0].pattern).toBe('^(?:a\\.b|failed)')
  fireEvent.click(screen.getByRole('button', { name: /Предупреждения/ }))
  expect((screen.getByLabelText('Слова и фразы') as HTMLTextAreaElement).value).toBe(
    'WARN\nWARNING',
  )
})
it('preserves custom expressions until explicit confirmed replacement', () => {
  const changed = vi.fn(),
    custom = { ...DEFAULT_HIGHLIGHT_RULES[0], pattern: '(a+)+$' }
  render(<Editor initial={[custom]} changed={changed} />)
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Слова и фразы')).toBeNull()
  fireEvent.click(screen.getByText('Расширенные настройки'))
  fireEvent.click(screen.getByRole('button', { name: 'Перейти к словам и фразам' }))
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выражение' }))
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Перейти к словам и фразам' }))
  fireEvent.click(screen.getByRole('button', { name: 'Заменить условие' }))
  expect(changed.mock.lastCall?.[0][0].pattern).toBe('')
  expect(screen.getByLabelText('Слова и фразы')).toBeTruthy()
})
it('reorders, adds and deletes rules while preserving host inheritance', () => {
  const changed = vi.fn()
  render(<Editor changed={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Переместить правило ниже' }))
  expect(changed.mock.lastCall?.[0].map((rule: HighlightRule) => rule.id)).toEqual([
    'warning',
    'error',
    'ok',
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Добавить правило' }))
  expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('Новое правило')
  fireEvent.click(screen.getByRole('button', { name: 'Удалить правило Новое правило' }))
  expect(changed.mock.lastCall?.[0]).toHaveLength(3)
  cleanup()
  render(<HighlightRulesEditor inherited value={undefined} onChange={changed} />)
  expect(screen.queryByLabelText('Название')).toBeNull()
  fireEvent.click(screen.getByLabelText('Использовать общие правила'))
  expect(changed.mock.lastCall?.[0]).toEqual(DEFAULT_HIGHLIGHT_RULES)
})

it('adds optional presets individually without changing existing rules or creating duplicates', () => {
  const changed = vi.fn()
  render(<Editor changed={changed} />)
  fireEvent.click(screen.getByText('Готовые правила'))
  fireEvent.click(screen.getByRole('button', { name: 'Добавить: Информация' }))
  const rules = changed.mock.lastCall?.[0] as HighlightRule[]
  expect(rules.slice(0, 3)).toEqual(DEFAULT_HIGHLIGHT_RULES)
  expect(rules).toHaveLength(4)
  expect(rules[3].id).not.toBe('info')
  expect((screen.getByLabelText('Слова и фразы') as HTMLTextAreaElement).value).toBe('INFO\nNOTICE')
  const added = screen.getByRole('button', { name: 'Добавлено: Информация' }) as HTMLButtonElement
  expect(added.disabled).toBe(true)
  fireEvent.click(added)
  expect(changed).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Удалить правило Информация' }))
  expect(
    (screen.getByRole('button', { name: 'Добавить: Информация' }) as HTMLButtonElement).disabled,
  ).toBe(false)
})
