import { afterEach, describe, expect, it } from 'vitest'
import { newTask } from '../actions'
import { setLocale, t } from '../i18n'
import { customToRule, describe as describeRule, presetRule } from '../lib/recurrence'
import { hashId, upcomingReminders } from '../native'

afterEach(() => setLocale('en'))

describe('i18n', () => {
  it('translates with parameters and falls back per locale', () => {
    setLocale('ru')
    expect(t('movedToToday', { n: 3 })).toBe('Перенесено на сегодня: 3')
    setLocale('en')
    expect(t('events', { n: 5 })).toBe('5 events')
  })

  it('describes repeat rules in both languages', () => {
    const task = (rrule: string | null) => ({ date: '2026-09-21', rrule })
    setLocale('en')
    expect(describeRule(task(presetRule('weekdays', '2026-09-21')))).toBe('on weekdays')
    expect(describeRule(task(presetRule('biweekly', '2026-09-21')))).toBe('every 2 weeks on Mo')
    expect(describeRule(task(presetRule('monthly', '2026-09-21')))).toBe('every month on day 21')
    setLocale('ru')
    expect(describeRule(task(presetRule('daily', '2026-09-21')))).toBe('каждый день')
    const custom = customToRule({ freq: 'WEEKLY', interval: 1, weekdays: [0, 2], end: 'count', until: '', count: 4 })
    expect(describeRule(task(custom))).toBe('каждую неделю по вт, вс 4 раз')
  })
})

describe('android reminder schedule', () => {
  it('lists future, not-done occurrences with stable ids', () => {
    const now = new Date(2026, 8, 21, 12, 0)
    const daily = newTask({ calendarId: 'c', title: 'Pills', date: '2026-09-21', reminder: '09:00', rrule: presetRule('daily', '2026-09-21'), doneDates: ['2026-09-22'] })
    const once = newTask({ calendarId: 'c', title: 'Call', date: '2026-09-21', reminder: '18:30' })
    const r = upcomingReminders([daily, once], now).filter((x) => x.at < new Date(2026, 8, 24).getTime())
    expect(r.map((x) => [new Date(x.at).getDate(), x.title])).toEqual([
      [21, 'Call'],
      [23, 'Pills'],
    ])
    expect(r[1].id).toBe(hashId(`${daily.id}@2026-09-23`))
    expect(r[1].date).toBe('2026-09-23')
    expect(r[0].date).toBe('')
  })
})
