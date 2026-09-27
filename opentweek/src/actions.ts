import { db, uid } from './db'
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

export async function updateTask(id: string, patch: Partial<Task>) {
  await db.tasks.update(id, { ...patch, updatedAt: Date.now() })
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

export async function deleteTask(id: string): Promise<Task | undefined> {
  const task = await db.tasks.get(id)
  await db.tasks.delete(id)
  return task
}

export async function restoreTask(task: Task) {
  await db.tasks.put(task)
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
  await db.transaction('rw', db.tasks, async () => {
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
  const fixed = new Set(targetItems.filter((i) => i.occurrence && i.key !== item.key).map((i) => i.task.id))
  await db.transaction('rw', db.tasks, async () => {
    let order = 0
    for (const id of ordered) {
      if (fixed.has(id)) continue
      await db.tasks.update(id, { order: ++order })
    }
  })
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
  await db.transaction('rw', db.tasks, async () => {
    await Promise.all(stale.map((t, i) => db.tasks.update(t.id, { date: today, order: -stale.length + i })))
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
  await db.transaction('rw', db.lists, db.tasks, async () => {
    await db.tasks.where('listId').equals(id).delete()
    await db.lists.delete(id)
  })
}

export async function deleteCalendar(id: string) {
  await db.transaction('rw', db.calendars, db.lists, db.tasks, async () => {
    await db.tasks.where('calendarId').equals(id).delete()
    await db.lists.where('calendarId').equals(id).delete()
    await db.calendars.delete(id)
  })
}
