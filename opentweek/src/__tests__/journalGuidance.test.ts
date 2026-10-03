import { afterEach, expect, it, vi } from 'vitest'
import { CONTEXTS, getGuidance, JOURNAL_FIELDS } from '../lib/journalGuidance'

afterEach(() => vi.unstubAllGlobals())

it('offers every journal field without requiring an answer', () => {
  expect(JOURNAL_FIELDS.map(field => field.key)).toEqual(['thoughts', 'feelings', 'body', 'perspective', 'action', 'after', 'needs'])
  for (const field of JOURNAL_FIELDS) {
    expect(field.optional).toBe(true)
    expect(field.label.length).toBeGreaterThan(0)
    expect(field.prompt).toContain('Можно пропустить')
  }
})

it.each([
  ['work', 'Работа'], ['relationships', 'Отношения'], ['rest', 'Отдых'],
  ['change', 'Перемены'], ['other', 'Другое'],
])('uses only the explicitly selected %s context and explains the rule', (value, label) => {
  expect(CONTEXTS).toContainEqual({ value, label })
  const result = getGuidance(value)
  expect(result.reason).toContain(label)
  expect(result.reason).toContain('Можно пропустить')
  expect(result.prompts.length).toBeGreaterThan(0)
  expect(result.feelings).toContain('Радость')
  expect(result.feelings).toContain('Грусть')
  expect(result.needs).toContain('Поддержка')
  expect(result).toEqual(getGuidance(value))
})

it.each([undefined, '', 'unknown', 'WORK', 'работа', 'I feel anxious about work', '__proto__', 'constructor'])('uses general suggestions for an unselected or unrecognised context (%s)', context => {
  expect(getGuidance(context)).toEqual(getGuidance())
  expect(getGuidance(context).reason).toContain('Общие подсказки')
})

it('works synchronously when network and browser storage are unavailable', () => {
  const unavailable = () => { throw new Error('External access is unavailable') }
  vi.stubGlobal('fetch', unavailable)
  vi.stubGlobal('localStorage', new Proxy({}, { get: unavailable }))
  vi.stubGlobal('indexedDB', new Proxy({}, { get: unavailable }))
  expect(getGuidance('work').prompts.length).toBeGreaterThan(0)
})

it('does not let callers mutate future suggestions', () => {
  const original = getGuidance('work')
  const edited = getGuidance('work')
  edited.prompts.length = 0
  edited.feelings.push('injected')
  edited.needs.length = 0
  expect(getGuidance('work')).toEqual(original)
})
