import Dexie, { type EntityTable } from 'dexie'
import { t } from './i18n'
import type { Calendar, Feed, JournalEntry, Settings, SomedayList, Task } from './types'

interface KV {
  key: string
  value: unknown
}

export class OpenTweekDB extends Dexie {
  journalEntries!: EntityTable<JournalEntry, 'id'>
  tasks!: EntityTable<Task, 'id'>
  lists!: EntityTable<SomedayList, 'id'>
  calendars!: EntityTable<Calendar, 'id'>
  feeds!: EntityTable<Feed, 'id'>
  kv!: EntityTable<KV, 'key'>

  constructor(name = 'opentweek') {
    super(name)
    this.version(1).stores({
      tasks: 'id, calendarId, date, listId, updatedAt',
      lists: 'id, calendarId, order',
      calendars: 'id, order',
      feeds: 'id',
      kv: 'key',
    })
    this.version(2).stores({ journalEntries: 'id, date, updatedAt' })
  }
}

export const db = new OpenTweekDB()

export const uid = () => crypto.randomUUID()

export const DEFAULT_SETTINGS: Settings = {
  activeCalendarId: '',
  language: 'auto',
  weekStartsOn: 1,
  weekendLayout: 'compact',
  theme: 'system',
  accent: 'blue',
  paper: 'lined',
  hideCompleted: false,
  autoRollover: false,
  showWeekNumbers: true,
  showSomeday: true,
  fontScale: 1,
  notifications: false,
  corsProxy: '',
  view: 'week',
}

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}

export async function updateSettings(patch: Partial<Settings>) {
  await db.transaction('rw', db.kv, async () => {
    const current = await getSettings()
    await db.kv.put({ key: 'settings', value: { ...current, ...patch } })
  })
}

/** First run: create a calendar and a Someday list so the board isn't empty. */
export async function ensureSeed() {
  await db.transaction('rw', db.calendars, db.lists, db.kv, async () => {
    let calendars = await db.calendars.orderBy('order').toArray()
    if (calendars.length === 0) {
      const cal: Calendar = { id: uid(), name: t('personal'), color: 'blue', order: 0 }
      await db.calendars.add(cal)
      await db.lists.add({ id: uid(), calendarId: cal.id, name: t('someday'), order: 0 })
      calendars = [cal]
    }
    const settings = await getSettings()
    if (!calendars.some((c) => c.id === settings.activeCalendarId)) {
      await db.kv.put({ key: 'settings', value: { ...settings, activeCalendarId: calendars[0].id } })
    }
  })
}
