import ICAL from 'ical.js'
import type { FeedEvent, Task } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const isoFromTime = (t: ICAL.Time) => {
  // All-day values are floating dates; timed values are converted to local time.
  const d = t.isDate ? new Date(t.year, t.month - 1, t.day) : t.toJSDate()
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: t.isDate ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/**
 * Parse an iCalendar document into flat read-only events, expanding recurring
 * events that fall within [from, to] (yyyy-MM-dd).
 */
export function parseEvents(text: string, from: string, to: string, limit = 5000): FeedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  const vevents = root.getAllSubcomponents('vevent')
  const start = ICAL.Time.fromDateString(from)
  // Exclusive upper bound: the day after `to`, so timed events on `to` are kept.
  const end = ICAL.Time.fromDateString(to)
  end.adjust(1, 0, 0, 0)

  // Attach RECURRENCE-ID overrides to their master events.
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const vevent of vevents) {
    const ev = new ICAL.Event(vevent)
    if (vevent.hasProperty('recurrence-id')) exceptions.push(ev)
    else masters.set(ev.uid, ev)
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex)

  const out: FeedEvent[] = []
  const push = (uid: string, summary: string, s: ICAL.Time, e: ICAL.Time | null, location: string | null) => {
    const a = isoFromTime(s)
    const b = e && !e.isDate ? isoFromTime(e) : null
    out.push({
      uid,
      title: summary || '(no title)',
      date: a.date,
      time: a.time,
      endTime: b && b.date === a.date ? b.time : null,
      location: location || null,
    })
  }

  for (const ev of masters.values()) {
    if (out.length >= limit) break
    if (ev.isRecurring()) {
      const it = ev.iterator()
      let next: ICAL.Time | null
      let guard = 0
      while ((next = it.next()) && next.compare(end) < 0 && guard++ < 2000) {
        if (next.compare(start) < 0) continue
        const occ = ev.getOccurrenceDetails(next)
        push(`${ev.uid}@${next.toString()}`, occ.item.summary, occ.startDate, occ.endDate, occ.item.location)
      }
    } else if (ev.startDate) {
      const d = isoFromTime(ev.startDate).date
      if (d >= from && d <= to) push(ev.uid, ev.summary, ev.startDate, ev.endDate, ev.location)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

export interface ImportedTask {
  title: string
  date: string
  note: string
  rrule: string | null
  done: boolean
}

/** Convert VEVENT/VTODO entries into tasks (one per entry, repeat rules kept). */
export function parseTasks(text: string): ImportedTask[] {
  const root = new ICAL.Component(ICAL.parse(text))
  const out: ImportedTask[] = []
  for (const comp of [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')]) {
    if (comp.hasProperty('recurrence-id')) continue
    const start = (comp.getFirstPropertyValue('dtstart') ?? comp.getFirstPropertyValue('due')) as ICAL.Time | null
    if (!start) continue
    const rrule = comp.getFirstProperty('rrule')
    const status = String(comp.getFirstPropertyValue('status') ?? '').toUpperCase()
    out.push({
      title: String(comp.getFirstPropertyValue('summary') ?? '(no title)'),
      date: isoFromTime(start).date,
      note: String(comp.getFirstPropertyValue('description') ?? ''),
      rrule: rrule ? rrule.toICALString().replace(/^RRULE:/i, '') : null,
      done: status === 'COMPLETED',
    })
  }
  return out
}

const escapeText = (s: string) =>
  s.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/\r?\n/g, '\\n')

/** Fold content lines at 75 octets as required by RFC 5545. */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compact = (iso: string) => iso.replaceAll('-', '')
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Export dated tasks as all-day VEVENTs (what Google/Apple Calendar import best). */
export function exportICS(tasks: Task[], calendarName: string): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//opentweek//opentweek//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ]
  for (const t of tasks) {
    if (!t.date) continue
    const description = [
      t.note,
      ...t.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`),
    ]
      .filter(Boolean)
      .join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@opentweek`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${compact(t.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(t.date))}`,
      `SUMMARY:${escapeText(t.title)}`,
    )
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
    if (t.rrule) lines.push(`RRULE:${t.rrule}`)
    if (t.rrule && t.exdates.length) lines.push(`EXDATE;VALUE=DATE:${t.exdates.map(compact).join(',')}`)
    if (!t.rrule && t.done) lines.push('STATUS:CONFIRMED', 'X-OPENTWEEK-DONE:TRUE')
    if (t.reminder) {
      const [h, m] = t.reminder.split(':')
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(t.title)}`, `TRIGGER:PT${+h}H${+m}M`, 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
