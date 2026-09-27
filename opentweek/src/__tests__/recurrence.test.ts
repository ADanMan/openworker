import { describe, expect, it } from 'vitest'
import { newTask } from '../actions'
import { customToRule, detectPreset, expand, occurrences, parseCustom, presetRule } from '../lib/recurrence'

const task = (over = {}) => newTask({ calendarId: 'c', date: '2026-09-21', ...over })

describe('recurrence', () => {
  it('expands weekday presets and skips weekends', () => {
    const t = task({ rrule: presetRule('weekdays', '2026-09-21') })
    expect(occurrences(t, '2026-09-21', '2026-09-27')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ])
  })

  it('never produces occurrences before the start date', () => {
    const t = task({ rrule: presetRule('daily', '2026-09-21') })
    expect(occurrences(t, '2026-09-14', '2026-09-22')).toEqual(['2026-09-21', '2026-09-22'])
  })

  it('honours exdates and marks done dates', () => {
    const t = task({ rrule: presetRule('daily', '2026-09-21'), exdates: ['2026-09-22'], doneDates: ['2026-09-23'] })
    const items = expand([t], '2026-09-21', '2026-09-23')
    expect(items.map((i) => [i.date, i.done])).toEqual([
      ['2026-09-21', false],
      ['2026-09-23', true],
    ])
    expect(items[0].key).toBe(`${t.id}@2026-09-21`)
  })

  it('round-trips presets', () => {
    for (const p of ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'] as const) {
      expect(detectPreset(presetRule(p, '2026-09-23'), '2026-09-23')).toBe(p)
    }
  })

  it('builds custom rules with end conditions', () => {
    const rule = customToRule({ freq: 'WEEKLY', interval: 2, weekdays: [1, 4], end: 'count', until: '', count: 3 })
    const t = task({ rrule: rule })
    expect(occurrences(t, '2026-09-01', '2026-12-31')).toEqual(['2026-09-21', '2026-09-24', '2026-10-05'])
    expect(parseCustom(rule, '2026-09-21')).toMatchObject({ freq: 'WEEKLY', interval: 2, weekdays: [1, 4], end: 'count', count: 3 })
  })

  it('includes the until date', () => {
    const rule = customToRule({ freq: 'DAILY', interval: 1, weekdays: [], end: 'until', until: '2026-09-23', count: 1 })
    expect(occurrences(task({ rrule: rule }), '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ])
  })

  it('keeps one-off tasks in range and all someday tasks', () => {
    const items = expand(
      [task({ date: '2026-09-21' }), task({ date: '2026-10-21' }), task({ date: null, listId: 'l' })],
      '2026-09-21',
      '2026-09-27',
    )
    expect(items.map((i) => i.date)).toEqual(['2026-09-21', null])
  })
})
