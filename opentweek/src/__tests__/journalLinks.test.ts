import { beforeEach, expect, it } from 'vitest'
import { db } from '../db'
import { addTask, dayContainer, updateTask, deleteTask, restoreTask, detachOccurrence, skipOccurrence, deleteCalendar, deleteList } from '../actions'
import { saveJournalEntry, saveJournalDraft } from '../lib/journal'
import { expand } from '../lib/recurrence'
const date = '2026-10-03'
beforeEach(async () => { await Promise.all([db.tasks.clear(), db.journalEntries.clear(), db.journalDrafts.clear(), db.calendars.clear(), db.lists.clear()]) })
async function linked(repeating = false) {
  const task = await addTask('cal', dayContainer(date), 'Private task title')
  if (repeating) { task.rrule = 'FREQ=DAILY'; await updateTask(task.id, { rrule: task.rrule }) }
  const draft = { id: 'j', date, text: 'Private reflection', mood: null, taskId: task.id, occurrenceDate: repeating ? date : null }
  await saveJournalEntry(draft)
  await saveJournalDraft({ ...draft, text: '' })
  return task
}
it('references renamed tasks without copying titles; moves both stores and preserves deleted content', async () => {
  const task = await linked()
  await updateTask(task.id, { title: 'New title', date: '2026-10-04' })
  for (const table of [db.journalEntries, db.journalDrafts]) expect(await table.get('j')).toMatchObject({ taskId: task.id, date: '2026-10-04' })
  expect(JSON.stringify(await db.journalEntries.get('j'))).not.toContain('title')
  await deleteTask(task.id)
  expect(await db.journalEntries.get('j')).toMatchObject({ taskId: null, date: '2026-10-04', text: 'Private reflection' })
  expect(await db.journalDrafts.get('j')).toMatchObject({ taskId: null, text: '' })
})
it('relinks moved occurrences and detaches skipped occurrences', async () => {
  const task = await linked(true)
  const item = expand([task], date, date)[0]
  const copy = await detachOccurrence(item, { date: '2026-10-05', listId: null })
  expect(await db.journalEntries.get('j')).toMatchObject({ taskId: copy.id, occurrenceDate: null, date: '2026-10-05' })
  const next = { ...item, date: '2026-10-04' }
  await saveJournalEntry({ id: 'next', date: next.date, text: 'Keep', mood: null, taskId: task.id, occurrenceDate: next.date })
  await skipOccurrence(next)
  expect(await db.journalEntries.get('next')).toMatchObject({ taskId: null, date: next.date, text: 'Keep' })
})
it.each(['calendar', 'list'])('detaches entries when deleting a %s', async kind => {
  const task = await linked()
  if (kind === 'list') { await updateTask(task.id, { date: null, listId: 'list' }); await deleteList('list') }
  else await deleteCalendar('cal')
  expect(await db.journalEntries.get('j')).toMatchObject({ taskId: null, text: 'Private reflection', date })
})
it('keeps linked private entry and draft content out of ICS and task sharing', async () => {
  const task = await linked()
  const { exportICS } = await import('../lib/ics')
  const { toShared, encodeShare, decodeShare } = await import('../lib/share')
  const shared = await decodeShare(await encodeShare({ v: 1, title: 'Calendar', tasks: [toShared(task)] }))
  expect(JSON.stringify(shared)).not.toContain('Private reflection')
  expect(JSON.stringify(shared)).not.toContain('journal')
  expect(exportICS([task], 'Calendar')).not.toContain('Private reflection')
})
it.each([undefined, '2026-10-04'])('links saved entries and drafts to the matching occurrence when enabling repeat (%s)', async movedDate => {
  const task = await linked()
  await updateTask(task.id, { rrule: 'FREQ=DAILY', ...(movedDate ? { date: movedDate } : {}) })
  for (const table of [db.journalEntries, db.journalDrafts]) {
    expect(await table.get('j')).toMatchObject({ taskId: task.id, date: movedDate ?? date, occurrenceDate: movedDate ?? date })
    expect(await table.where('taskId').equals(task.id).filter(row => row.occurrenceDate === (movedDate ?? date)).count()).toBe(1)
  }
  expect(await db.journalEntries.get('j')).toMatchObject({ text: 'Private reflection' })
  expect(await db.journalDrafts.get('j')).toMatchObject({ text: '' })
})
it('detaches links while preserving entries and drafts when the original date is excluded by the new repeat rule', async () => {
  const task = await linked()
  await updateTask(task.id, { rrule: 'FREQ=WEEKLY;BYDAY=MO' })
  expect(await db.journalEntries.get('j')).toMatchObject({ taskId: null, occurrenceDate: null, date, text: 'Private reflection' })
  expect(await db.journalDrafts.get('j')).toMatchObject({ taskId: null, occurrenceDate: null, date, text: '' })
})
it('preserves private history as detached entries when a repeating task becomes one-off', async () => {
  const task = await linked(true)
  await updateTask(task.id, { rrule: null })
  for (const table of [db.journalEntries, db.journalDrafts]) expect(await table.get('j')).toMatchObject({ taskId: null, occurrenceDate: null, date })
})
it.each([false, true])('restores unchanged journal and draft links on task undo (repeating=%s)', async repeating => {
  const task = await linked(repeating)
  const removed = await deleteTask(task.id)
  await restoreTask(removed!)
  for (const table of [db.journalEntries, db.journalDrafts]) expect(await table.get('j')).toMatchObject({ taskId: task.id, occurrenceDate: repeating ? date : null, date })
  expect(await db.tasks.get(task.id)).toEqual(removed)
})
it('does not overwrite journal or draft edits made after task deletion during undo', async () => {
  const task = await linked()
  await deleteTask(task.id)
  await saveJournalEntry({ id: 'j', date, text: 'Edited after deletion', mood: null })
  await saveJournalDraft({ id: 'j', date, text: 'New draft after deletion', mood: null })
  await restoreTask(task)
  expect(await db.journalEntries.get('j')).toMatchObject({ taskId: null, text: 'Edited after deletion' })
  expect(await db.journalDrafts.get('j')).toMatchObject({ taskId: null, text: 'New draft after deletion' })
})
