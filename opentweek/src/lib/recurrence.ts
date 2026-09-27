import { RRule, rrulestr, Frequency, Weekday } from 'rrule'
import type { Item, Task } from '../types'

// rrule works in "floating" UTC: we treat every yyyy-MM-dd as UTC midnight so
// occurrences never drift across a timezone boundary.
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const isoUTC = (d: Date) => d.toISOString().slice(0, 10)
const stamp = (iso: string) => iso.replaceAll('-', '') + 'T000000Z'

export function buildRule(task: Pick<Task, 'date' | 'rrule'>): RRule | null {
  if (!task.rrule || !task.date) return null
  try {
    return rrulestr(`DTSTART:${stamp(task.date)}\nRRULE:${task.rrule}`) as RRule
  } catch {
    return null
  }
}

/** Occurrence dates of a repeating task within [from, to] (inclusive, yyyy-MM-dd). */
export function occurrences(task: Task, from: string, to: string): string[] {
  const rule = buildRule(task)
  if (!rule) return []
  const skip = new Set(task.exdates)
  return rule
    .between(utc(from), utc(to), true)
    .map(isoUTC)
    .filter((d) => !skip.has(d))
}

export function describe(task: Pick<Task, 'date' | 'rrule'>): string {
  const rule = buildRule(task)
  return rule ? rule.toText() : ''
}

/** Expand tasks into visible rows for the given date range (plus all Someday tasks). */
export function expand(tasks: Task[], from: string, to: string): Item[] {
  const items: Item[] = []
  for (const task of tasks) {
    if (task.rrule && task.date) {
      for (const date of occurrences(task, from, to)) {
        items.push({
          key: `${task.id}@${date}`,
          task,
          date,
          occurrence: true,
          done: task.doneDates.includes(date),
        })
      }
    } else if (task.listId || (task.date && task.date >= from && task.date <= to)) {
      items.push({ key: task.id, task, date: task.date, occurrence: false, done: task.done })
    }
  }
  return items.sort((a, b) => a.task.order - b.task.order || a.task.createdAt - b.task.createdAt)
}

export type RepeatPreset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom'

const WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA]

export function presetRule(preset: RepeatPreset, date: string): string | null {
  const dow = WEEKDAYS[utc(date).getUTCDay()]
  const body = (opts: Partial<ConstructorParameters<typeof RRule>[0]>) =>
    RRule.optionsToString(opts as never).replace(/^RRULE:/, '')
  switch (preset) {
    case 'none':
      return null
    case 'daily':
      return body({ freq: Frequency.DAILY })
    case 'weekdays':
      return body({ freq: Frequency.WEEKLY, byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR] })
    case 'weekly':
      return body({ freq: Frequency.WEEKLY, byweekday: [dow] })
    case 'biweekly':
      return body({ freq: Frequency.WEEKLY, interval: 2, byweekday: [dow] })
    case 'monthly':
      return body({ freq: Frequency.MONTHLY, bymonthday: [utc(date).getUTCDate()] })
    case 'yearly':
      return body({ freq: Frequency.YEARLY })
    case 'custom':
      return body({ freq: Frequency.WEEKLY, byweekday: [dow] })
  }
}

export function detectPreset(rrule: string | null, date: string | null): RepeatPreset {
  if (!rrule || !date) return 'none'
  const presets: RepeatPreset[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly']
  return presets.find((p) => presetRule(p, date) === rrule) ?? 'custom'
}

export interface CustomRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  /** 0 = Sunday ... 6 = Saturday */
  weekdays: number[]
  end: 'never' | 'until' | 'count'
  until: string
  count: number
}

export function parseCustom(rrule: string | null, date: string): CustomRule {
  const fallback: CustomRule = {
    freq: 'WEEKLY',
    interval: 1,
    weekdays: [utc(date).getUTCDay()],
    end: 'never',
    until: date,
    count: 10,
  }
  if (!rrule) return fallback
  try {
    const o = RRule.parseString(rrule)
    const freqs: CustomRule['freq'][] = ['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY']
    const freq = freqs[o.freq ?? Frequency.WEEKLY] ?? 'WEEKLY'
    const byweekday = (Array.isArray(o.byweekday) ? o.byweekday : o.byweekday != null ? [o.byweekday] : [])
      .map((w) => (w instanceof Weekday ? w.weekday : typeof w === 'number' ? w : 0))
      // rrule weekday: 0 = Monday; convert to JS 0 = Sunday
      .map((w) => (w + 1) % 7)
    return {
      freq,
      interval: o.interval ?? 1,
      weekdays: byweekday.length ? byweekday : fallback.weekdays,
      end: o.until ? 'until' : o.count ? 'count' : 'never',
      until: o.until ? isoUTC(o.until) : date,
      count: o.count ?? 10,
    }
  } catch {
    return fallback
  }
}

export function customToRule(c: CustomRule): string {
  const freq = { DAILY: Frequency.DAILY, WEEKLY: Frequency.WEEKLY, MONTHLY: Frequency.MONTHLY, YEARLY: Frequency.YEARLY }[
    c.freq
  ]
  const opts: Partial<ConstructorParameters<typeof RRule>[0]> = { freq, interval: Math.max(1, c.interval) }
  if (c.freq === 'WEEKLY' && c.weekdays.length) opts.byweekday = [...c.weekdays].sort().map((d) => WEEKDAYS[d])
  if (c.end === 'until') opts.until = new Date(utc(c.until).getTime() + 86_399_000)
  if (c.end === 'count') opts.count = Math.max(1, c.count)
  return RRule.optionsToString(opts as never).replace(/^RRULE:/, '')
}
