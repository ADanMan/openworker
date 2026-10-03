import { afterEach, beforeEach, expect, it } from 'vitest'
import { OpenTweekDB } from '../db'
import { insertWakeDraft } from '../lib/journalWake'
import { saveJournalEntry } from '../lib/journal'
let database: OpenTweekDB
beforeEach(() => { database = new OpenTweekDB(`wake-test-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
const draft = { id: 'entry', date: '2026-10-03', text: 'Before', mood: null }
it('inserts once, survives recreation and does not create a completed entry', async () => {
  await insertWakeDraft(draft, 'text', 'Local speech', 'session', database)
  const restored = (await database.journalDrafts.get('entry'))!
  await insertWakeDraft(restored, 'text', 'Local speech', 'session', database)
  expect((await database.journalDrafts.get('entry'))?.text).toBe('Before\nLocal speech')
  expect(await database.journalEntries.count()).toBe(0)
})
it('rolls back the text if saving its receipt fails, so retry adds it once', async () => {
  const reject = () => { throw new Error('disk failure') }
  database.kv.hook('creating', reject)
  await expect(insertWakeDraft(draft, 'text', 'Local speech', 'session', database)).rejects.toThrow('disk failure')
  expect(await database.journalDrafts.count()).toBe(0)
  database.kv.hook('creating').unsubscribe(reject)
  await insertWakeDraft(draft, 'text', 'Local speech', 'session', database)
  expect((await database.journalDrafts.get('entry'))?.text).toBe('Before\nLocal speech')
})
it('a replay cannot copy a recovered transcript into a different entry or recreate a finalized draft', async () => {
  const saved = (await insertWakeDraft(draft, 'thoughts', 'Local speech', 'session', database))!
  await saveJournalEntry(saved, database)
  expect(await insertWakeDraft(draft, 'text', 'Local speech', 'session', database)).toBeUndefined()
  expect(await insertWakeDraft({ ...draft, id: 'other' }, 'text', 'Local speech', 'session', database)).toBeUndefined()
  expect(await database.journalDrafts.count()).toBe(0)
  expect((await database.journalEntries.get('entry'))?.thoughts).toBe('Local speech')
})
it('retains recovery when the selected field would truncate it', async () => {
  await expect(insertWakeDraft({ ...draft, text: 'x'.repeat(100000) }, 'text', 'Speech', 'session', database)).rejects.toThrow('full')
  expect(await database.kv.count()).toBe(0)
  expect(await database.journalDrafts.count()).toBe(0)
})
it('receipt replay returns no stale draft that could overwrite unsaved editor changes', async () => {
  await insertWakeDraft(draft, 'text', 'Local speech', 'session', database)
  const unsaved = { ...draft, text: 'My newer unsaved changes' }
  expect(await insertWakeDraft(unsaved, 'text', 'Local speech', 'session', database)).toBeUndefined()
  expect(unsaved.text).toBe('My newer unsaved changes')
})
