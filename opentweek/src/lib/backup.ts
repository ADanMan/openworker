import { db, type OpenTweekDB } from '../db'
import type { Attachment, Calendar, Feed, JournalEntry, SomedayList, Task } from '../types'

import { validateJournalEntry } from './journal'
import { occurrences } from './recurrence'

interface BackupAttachment extends Omit<Attachment, 'blob'> {
  dataUrl: string
}
interface BackupTask extends Omit<Task, 'attachments'> {
  attachments: BackupAttachment[]
}
export interface Backup {
  app: 'opentweek'
  version: 3
  journalEntries: JournalEntry[]
  exportedAt: string
  calendars: Calendar[]
  lists: SomedayList[]
  tasks: BackupTask[]
  feeds: Omit<Feed, 'events'>[]
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export async function exportBackup(database: OpenTweekDB = db): Promise<Backup> {
  const [calendars, lists, tasks, feeds, journalEntries] = await database.transaction('r', [database.calendars, database.lists, database.tasks, database.feeds, database.journalEntries], () => Promise.all([
    database.calendars.toArray(),
    database.lists.toArray(),
    database.tasks.toArray(),
    database.feeds.toArray(),
    database.journalEntries.toArray(),
  ]))
  return {
    app: 'opentweek',
    version: 3,
    journalEntries,
    exportedAt: new Date().toISOString(),
    calendars,
    lists,
    tasks: await Promise.all(
      tasks.map(async (t) => ({
        ...t,
        attachments: await Promise.all(
          (t.attachments ?? []).map(async ({ blob, ...a }) => ({ ...a, dataUrl: await blobToDataUrl(blob) })),
        ),
      })),
    ),
    feeds: feeds.map(({ events: _events, ...f }) => f),
  }
}

/** Replace planner data; v1 preserves journal content, repairing links against restored tasks. */
export async function importBackup(input: unknown, database: OpenTweekDB = db) {
  if (!input || typeof input !== 'object') throw new Error('Not an opentweek backup file')
  const data = input as Backup
  if (data.app !== 'opentweek' || ![1, 2, 3].includes(data.version) || !Array.isArray(data.tasks) || !Array.isArray(data.calendars) || !Array.isArray(data.lists) || (data.feeds !== undefined && !Array.isArray(data.feeds))) throw new Error('Not an opentweek backup file')
  let journalEntries: JournalEntry[] | undefined
  if (data.version >= 2) {
    if (!Array.isArray(data.journalEntries)) throw new Error('Missing journal entries')
    journalEntries = data.journalEntries.map(validateJournalEntry)
    if (new Set(journalEntries.map(row => row.id)).size !== journalEntries.length) throw new Error('Duplicate journal id')
  }
  const tasks: Task[] = await Promise.all(
    data.tasks.map(async (t) => ({
      ...t,
      attachments: await Promise.all(
        (t.attachments ?? []).map(async ({ dataUrl, ...a }) => {
          // A backup attachment must never cause an external request during restore.
          if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) throw new Error('Invalid backup attachment')
          return { ...a, blob: await (await fetch(dataUrl)).blob() }
        }),
      ),
    })),
  )
  await database.transaction('rw', [database.calendars, database.lists, database.tasks, database.feeds, database.journalEntries, database.journalDrafts], async () => {
    await Promise.all([database.calendars.clear(), database.lists.clear(), database.tasks.clear(), database.feeds.clear()])
    await database.calendars.bulkAdd(data.calendars)
    await database.lists.bulkAdd(data.lists)
    await database.tasks.bulkAdd(tasks)
    await database.feeds.bulkAdd((data.feeds ?? []).map((f) => ({ ...f, events: [], fetchedAt: null, error: null })))
    const taskMap = new Map(tasks.map(task => [task.id, task]))
    const repair = (row: JournalEntry) => {
      if (!row.taskId) return
      const task = taskMap.get(row.taskId)
      if (!task || (task.rrule && !row.occurrenceDate) || (row.occurrenceDate && (!task.rrule || !occurrences({ ...task, exdates: task.exdates ?? [] }, row.occurrenceDate, row.occurrenceDate).length))) {
        row.taskId = null; row.occurrenceDate = null
      } else if (!task.rrule && task.date) row.date = task.date
    }
    if (journalEntries !== undefined) {
      journalEntries.forEach(repair)
      await database.journalEntries.clear()
      await database.journalEntries.bulkAdd(journalEntries)
    } else await database.journalEntries.toCollection().modify(repair)
    await database.journalDrafts.toCollection().modify(repair)
  })
}
