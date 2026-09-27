import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getISOWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { Settings } from '../types'

export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd')
export const fromISODate = (s: string) => parseISO(s)
export const todayISO = () => toISODate(new Date())

export function weekDays(anchor: Date, weekStartsOn: Settings['weekStartsOn']): string[] {
  const start = startOfWeek(anchor, { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)))
}

/** Days of the month grid (always whole weeks, 5 or 6 rows). */
export function monthGrid(anchor: Date, weekStartsOn: Settings['weekStartsOn']): string[][] {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn })
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn })
  const weeks: string[][] = []
  for (let d = start; d <= end; d = addWeeks(d, 1)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toISODate(addDays(d, i))))
  }
  return weeks
}

export const isWeekend = (iso: string) => {
  const day = fromISODate(iso).getDay()
  return day === 0 || day === 6
}

export const weekNumber = (iso: string) => getISOWeek(fromISODate(iso))

export const shift = (anchor: Date, view: Settings['view'], dir: number) =>
  view === 'week' ? addWeeks(anchor, dir) : addMonths(anchor, dir)

export const isoAddDays = (iso: string, n: number) => toISODate(addDays(fromISODate(iso), n))
