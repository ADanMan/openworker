import { db, uid } from './db'
import { updateJournalLinks } from './lib/journal'
import { occurrences } from './lib/recurrence'
import type { QuickAdd } from './lib/quickadd'
import type { ContainerId, Item, SomedayList, Task } from './types'

export const dayContainer = (date: string): ContainerId => `day:${date}`
export const listContainer = (id: string): ContainerId => `list:${id}`

export function parseContainer(c: ContainerId): { date: string | null; listId: string | null } {
  return c.startsWith('day:') ? { date: c.slice(4), listId: null } : { date: null, listId: c.slice(5) }
}

export const containerOf = (item: Item): ContainerId =>
  item.date ? dayContainer(item.date) : listContainer(item.task.listId!)

export function newTask(partial: Partial<Task> & Pick<Task, 'calendarId'>): Task {
  const now = Date.now()
  return {
    id: uid(),
    title: '',
    done: false,
    date: null,
    listId: null,
    order: now,
    color: 'none',
    note: '',
    subtasks: [],
    attachments: [],
    rrule: null,
    exdates: [],
    doneDates: [],
    reminder: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export async function addTask(calendarId: string, container: ContainerId, title: string, order?: number) {
  const { date, listId } = parseContainer(container)
  if (order === undefined) {
    const siblings = await db.tasks
      .where(date ? 'date' : 'listId')
      .equals((date ?? listId)!)
      .filter((t) => t.calendarId === calendarId)
      .toArray()
    order = siblings.reduce((max, t) => Math.max(max, t.order), 0) + 1
  }
  const task = newTask({ calendarId, date, listId, title: title.trim(), order })
  await db.tasks.add(task)
  return task
}

/** Create a task from a parsed quick-add phrase (voice or shared text). */
export async function addQuickTask(calendarId: string, q: QuickAdd) {
  const task = await addTask(calendarId, dayContainer(q.date), q.title)
  if (q.reminder || q.rrule) await updateTask(task.id, { reminder: q.reminder, rrule: q.rrule })
  return { ...task, reminder: q.reminder, rrule: q.rrule }
}

export async function updateTask(id: string, patch: Partial<Task>) {
  await db.transaction('rw', [db.tasks, db.journalEntries, db.journalDrafts], async () => {
    const task = await db.tasks.get(id)
    await db.tasks.update(id, { ...patch, updatedAt: Date.now() })
    if (task && !task.rrule && patch.date) await updateJournalLinks(id, { date: patch.date })
    if (task && !task.rrule && patch.rrule) {
      const updated = { ...task, ...patch }
      const occurrenceDate = updated.date
      const valid = occurrenceDate && occurrences(updated, occurrenceDate, occurrenceDate).length > 0
      await updateJournalLinks(id, valid ? { occurrenceDate, date: occurrenceDate } : { taskId: null, occurrenceDate: null })
    }
    if (patch.exdates) for (const date of patch.exdates) await updateJournalLinks(id, { taskId: null, occurrenceDate: null }, date)
    if (task?.rrule && (patch.rrule !== undefined || patch.date !== undefined)) {
      const updated = { ...task, ...patch }
      for (const table of [db.journalEntries, db.journalDrafts]) await table.where('taskId').equals(id).filter(row => !row.occurrenceDate || !occurrences(updated, row.occurrenceDate, row.occurrenceDate).length).modify({ taskId: null, occurrenceDate: null })
    }
  })
}

export async function toggleDone(item: Item) {
  const { task } = item
  if (item.occurrence && item.date) {
    const doneDates = item.done
      ? task.doneDates.filter((d) => d !== item.date)
      : [...task.doneDates, item.date]
    await updateTask(task.id, { doneDates })
  } else {
    await updateTask(task.id, { done: !task.done })
  }
}

// Undo metadata stays in memory, never on planner records or in exports.
const deletedTaskLinks = new Map<string, { saved: { id: string; occurrenceDate: string | null; detached: string }[]; drafts: { id: string; occurrenceDate: string | null; detached: string }[] }>()

export async function deleteTask(id: string): Promise<Task | undefined> {
  const undo = { saved: [] as { id: string; occurrenceDate: string | null; detached: string }[], drafts: [] as { id: string; occurrenceDate: string | null; detached: string }[] }
  const task = await db.transaction('rw', [db.tasks, db.journalEntries, db.journalDrafts], async () => {
    const task = await db.tasks.get(id)
    const saved = await db.journalEntries.where('taskId').equals(id).toArray()
    const drafts = await db.journalDrafts.where('taskId').equals(id).toArray()
    await updateJournalLinks(id, { taskId: null, occurrenceDate: null })
    for (const [rows, table, target] of [[saved, db.journalEntries, undo.saved], [drafts, db.journalDrafts, undo.drafts]] as const) {
      for (const row of rows) target.push({ id: row.id, occurrenceDate: row.occurrenceDate ?? null, detached: JSON.stringify(await table.get(row.id)) })
    }
    await db.tasks.delete(id)
    return task
  })
  if (task) {
    deletedTaskLinks.set(id, undo)
    // Bound temporary undo history even if a caller never restores tasks.
    if (deletedTaskLinks.size > 100) deletedTaskLinks.delete(deletedTaskLinks.keys().next().value!)
  }
  return task
}

export async function restoreTask(task: Task) {
  const undo = deletedTaskLinks.get(task.id)
  await db.transaction('rw', [db.tasks, db.journalEntries, db.journalDrafts], async () => {
    await db.tasks.put(task)
    if (!undo) return
    for (const [rows, table] of [[undo.saved, db.journalEntries], [undo.drafts, db.journalDrafts]] as const) {
      for (const row of rows) {
        const current = await table.get(row.id)
        // Do not relink notes edited, deleted, or reassigned since removal.
        if (current && JSON.stringify(current) === row.detached) await table.update(row.id, { taskId: task.id, occurrenceDate: row.occurrenceDate, updatedAt: Date.now() })
      }
    }
  })
  deletedTaskLinks.delete(task.id)
}

export async function skipOccurrence(item: Item) {
  if (!item.occurrence || !item.date) return
  await updateTask(item.task.id, { exdates: [...item.task.exdates, item.date] })
}

/** Turn one occurrence of a repeating task into a standalone task. */
export async function detachOccurrence(item: Item, target: { date: string | null; listId: string | null }) {
  const { task } = item
  const copy = newTask({
    ...task,
    id: uid(),
    rrule: null,
    exdates: [],
    doneDates: [],
    done: item.done,
    date: target.date,
    listId: target.listId,
    createdAt: Date.now(),
  })
  await db.transaction('rw', [db.tasks, db.journalEntries, db.journalDrafts], async () => {
    await updateJournalLinks(task.id, { taskId: copy.id, occurrenceDate: null, ...(target.date ? { date: target.date } : {}) }, item.date!)
    await db.tasks.update(task.id, {
      exdates: [...task.exdates, item.date!],
      doneDates: task.doneDates.filter((d) => d !== item.date),
      updatedAt: Date.now(),
    })
    await db.tasks.add(copy)
  })
  return copy
}

/**
 * Move `item` into `target` at `index`. `targetItems` are the rows currently in
 * the target container (in display order), used to renumber orders.
 */
export async function moveItem(item: Item, target: ContainerId, index: number, targetItems: Item[]) {
  const dest = parseContainer(target)
  const sameContainer = containerOf(item) === target
  let movedId = item.task.id

  if (item.occurrence && !sameContainer) {
    movedId = (await detachOccurrence(item, dest)).id
  } else if (!sameContainer) {
    await updateTask(item.task.id, { date: dest.date, listId: dest.listId })
  }

  // Renumber the container. Occurrences keep their series' order, since
  // renumbering them would reshuffle every other day the series appears on.
  const rows = targetItems.filter((i) => i.key !== item.key)
  const at = Math.max(0, Math.min(index, rows.length))
  const ordered = [...rows.slice(0, at).map((i) => i.task.id), movedId, ...rows.slice(at).map((i) => i.task.id)]
  const fixedOrder = new Map(
    targetItems.filter((i) => i.occurrence && i.key !== item.key).map((i) => [i.task.id, i.task.order]),
  )
  const orders = interleaveOrders(ordered.map((id) => fixedOrder.get(id) ?? null))
  await db.transaction('rw', db.tasks, async () => {
    await Promise.all(ordered.map((id, i) => (fixedOrder.has(id) ? null : db.tasks.update(id, { order: orders[i] }))))
  })
}

/**
 * Given a display sequence where some slots have a fixed order value (repeating
 * series) and the rest are free (null), assign free slots values that keep the
 * sequence strictly increasing without touching the fixed ones.
 */
export function interleaveOrders(slots: (number | null)[]): number[] {
  const out = [...slots] as number[]
  let i = 0
  while (i < slots.length) {
    if (slots[i] !== null) {
      i++
      continue
    }
    let j = i
    while (j < slots.length && slots[j] === null) j++
    const k = j - i
    let lo = i > 0 ? out[i - 1] : null
    let hi = j < slots.length ? (slots[j] as number) : null
    if (lo === null && hi === null) [lo, hi] = [0, k + 1]
    else if (lo === null) lo = hi! - (k + 1)
    else if (hi === null) hi = lo + (k + 1)
    for (let n = 0; n < k; n++) out[i + n] = lo + ((hi! - lo) * (n + 1)) / (k + 1)
    i = j
  }
  return out
}

/** Move a task to another day, keeping it at the end of that day. */
export async function moveToDate(item: Item, date: string) {
  if (item.occurrence) {
    await detachOccurrence(item, { date, listId: null })
    return
  }
  await updateTask(item.task.id, { date, listId: null, order: Date.now() })
}

export async function duplicateTask(task: Task) {
  const copy = newTask({ ...task, id: uid(), order: task.order + 0.5, createdAt: Date.now() })
  await db.tasks.add(copy)
  return copy
}

/** Move unfinished one-off tasks from past days to today. */
export async function rollover(calendarId: string, today: string) {
  const stale = await db.tasks
    .where('date')
    .below(today)
    .filter((t) => t.calendarId === calendarId && !t.done && !t.rrule)
    .toArray()
  if (!stale.length) return 0
  await db.transaction('rw', [db.tasks, db.journalEntries, db.journalDrafts], async () => {
    await Promise.all(stale.map(async (t, i) => {
      await db.tasks.update(t.id, { date: today, order: -stale.length + i })
      await updateJournalLinks(t.id, { date: today })
    }))
  })
  return stale.length
}

export async function addList(calendarId: string, name = 'New list') {
  const lists = await db.lists.where('calendarId').equals(calendarId).toArray()
  const list: SomedayList = {
    id: uid(),
    calendarId,
    name,
    order: lists.reduce((m, l) => Math.max(m, l.order), 0) + 1,
  }
  await db.lists.add(list)
  return list
}

export async function deleteList(id: string) {
  await db.transaction('rw', [db.lists, db.tasks, db.journalEntries, db.journalDrafts], async () => {
    for (const task of await db.tasks.where('listId').equals(id).toArray()) await updateJournalLinks(task.id, { taskId: null, occurrenceDate: null })
    await db.tasks.where('listId').equals(id).delete()
    await db.lists.delete(id)
  })
}

export async function deleteCalendar(id: string) {
  await db.transaction('rw', [db.calendars, db.lists, db.tasks, db.journalEntries, db.journalDrafts], async () => {
    for (const task of await db.tasks.where('calendarId').equals(id).toArray()) await updateJournalLinks(task.id, { taskId: null, occurrenceDate: null })
    await db.tasks.where('calendarId').equals(id).delete()
    await db.lists.where('calendarId').equals(id).delete()
    await db.calendars.delete(id)
  })
}
