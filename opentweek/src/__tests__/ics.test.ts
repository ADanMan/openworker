import { describe, expect, it } from 'vitest'
import { newTask } from '../actions'
import { exportICS, fold, parseEvents, parseTasks } from '../lib/ics'

describe('ics', () => {
  it('exports tasks that re-import as the same tasks', () => {
    const tasks = [
      newTask({ calendarId: 'c', title: 'Gym; legs, core', date: '2026-09-21', rrule: 'FREQ=WEEKLY;BYDAY=MO', note: 'line1\nline2' }),
      newTask({ calendarId: 'c', title: 'Someday thing', listId: 'l' }),
    ]
    const ics = exportICS(tasks, 'Personal')
    expect(ics).toContain('SUMMARY:Gym\\; legs\\, core')
    expect(ics).not.toContain('Someday thing')
    const back = parseTasks(ics)
    expect(back).toEqual([{ title: 'Gym; legs, core', date: '2026-09-21', note: 'line1\nline2', rrule: 'FREQ=WEEKLY;BYDAY=MO', done: false }])
  })

  it('folds long lines at 75 octets', () => {
    const folded = fold('SUMMARY:' + 'ж'.repeat(80))
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'ж'.repeat(80))
  })

  it('expands recurring feed events with overrides and all-day events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:standup',
      'DTSTART:20260921T090000',
      'DTEND:20260921T091500',
      'RRULE:FREQ=DAILY;COUNT=5',
      'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:standup',
      'RECURRENCE-ID:20260923T090000',
      'DTSTART:20260923T100000',
      'DTEND:20260923T101500',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:holiday',
      'DTSTART;VALUE=DATE:20260925',
      'DTEND;VALUE=DATE:20260926',
      'SUMMARY:Holiday',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const events = parseEvents(ics, '2026-09-22', '2026-09-25')
    expect(events.map((e) => [e.date, e.time, e.title])).toEqual([
      ['2026-09-22', '09:00', 'Standup'],
      ['2026-09-23', '10:00', 'Standup (moved)'],
      ['2026-09-24', '09:00', 'Standup'],
      ['2026-09-25', null, 'Holiday'],
      ['2026-09-25', '09:00', 'Standup'],
    ])
  })
})
