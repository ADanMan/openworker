import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { OpenTweekDB } from '../db'
import { deleteJournalEntry, JOURNAL_TEXT_MAX_LENGTH, saveJournalEntry } from '../lib/journal'
let database: OpenTweekDB
beforeEach(() => { database = new OpenTweekDB(`journal-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
const draft = { id: 'stable', date: '2026-10-03', text: ' Feeling calm ', mood: 4 as const }
it('upgrades v1 without replacing planner or settings', async () => {
  const old = new Dexie(database.name)
  old.version(1).stores({ tasks: 'id, calendarId, date, listId, updatedAt', lists: 'id, calendarId, order', calendars: 'id, order', feeds: 'id', kv: 'key' })
  await old.table('tasks').put({ id: 'task', title: 'keep' })
  await old.table('kv').put({ key: 'settings', value: { theme: 'dark' } })
  old.close()
  await database.open()
  expect((await database.tasks.get('task'))?.title).toBe('keep')
  expect((await database.kv.get('settings'))?.value).toEqual({ theme: 'dark' })
  expect(await database.journalEntries.count()).toBe(0)
})
it('upserts concurrent stable-id saves and preserves creation time', async () => {
  const first = await saveJournalEntry(draft, database)
  expect(first.text).toBe('Feeling calm')
  await Promise.all([saveJournalEntry({ ...draft, text: 'changed' }, database), saveJournalEntry({ ...draft, text: 'final' }, database)])
  expect(await database.journalEntries.count()).toBe(1)
  expect(await database.journalEntries.get(draft.id)).toMatchObject({ text: 'final', createdAt: first.createdAt })
  await deleteJournalEntry(draft.id, database)
  expect(await database.journalEntries.count()).toBe(0)
})
it.each([{ text: ' \n ' }, { text: 'x'.repeat(100001) }, { date: '2026-02-29' }, { date: '2026-13-01' }, { date: '2026-1-01' }, { mood: 6 }, { id: '' }])('rejects invalid draft (%#)', async patch => {
  await expect(saveJournalEntry({ ...draft, ...patch } as typeof draft, database)).rejects.toThrow()
  expect(await database.journalEntries.count()).toBe(0)
})
it('allows leap dates and bounded text with no mood', async () => {
  const entry = await saveJournalEntry({ ...draft, date: '2024-02-29', mood: null, text: 'x'.repeat(JOURNAL_TEXT_MAX_LENGTH) }, database)
  expect(entry.mood).toBeNull()
})
