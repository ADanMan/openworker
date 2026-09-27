import { db } from '../db'
import type { Attachment, Calendar, Feed, SomedayList, Task } from '../types'

interface BackupAttachment extends Omit<Attachment, 'blob'> {
  dataUrl: string
}
interface BackupTask extends Omit<Task, 'attachments'> {
  attachments: BackupAttachment[]
}
export interface Backup {
  app: 'opentweek'
  version: 1
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

export async function exportBackup(): Promise<Backup> {
  const [calendars, lists, tasks, feeds] = await Promise.all([
    db.calendars.toArray(),
    db.lists.toArray(),
    db.tasks.toArray(),
    db.feeds.toArray(),
  ])
  return {
    app: 'opentweek',
    version: 1,
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

/** Replace all data with the backup contents. */
export async function importBackup(data: Backup) {
  if (data?.app !== 'opentweek' || !Array.isArray(data.tasks)) throw new Error('Not an opentweek backup file')
  const tasks: Task[] = await Promise.all(
    data.tasks.map(async (t) => ({
      ...t,
      attachments: await Promise.all(
        (t.attachments ?? []).map(async ({ dataUrl, ...a }) => ({ ...a, blob: await (await fetch(dataUrl)).blob() })),
      ),
    })),
  )
  await db.transaction('rw', [db.calendars, db.lists, db.tasks, db.feeds], async () => {
    await Promise.all([db.calendars.clear(), db.lists.clear(), db.tasks.clear(), db.feeds.clear()])
    await db.calendars.bulkAdd(data.calendars)
    await db.lists.bulkAdd(data.lists)
    await db.tasks.bulkAdd(tasks)
    await db.feeds.bulkAdd((data.feeds ?? []).map((f) => ({ ...f, events: [], fetchedAt: null, error: null })))
  })
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
