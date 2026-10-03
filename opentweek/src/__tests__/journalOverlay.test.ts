import { afterEach, beforeEach, expect, it } from 'vitest'
import { OpenTweekDB } from '../db'
import { overlayReceipt, saveOverlayEntry } from '../lib/journalWake'
import { insertWakeDraft } from '../lib/journalWake'
let database: OpenTweekDB
beforeEach(() => { database = new OpenTweekDB(`overlay-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
const pending = { sessionId: 'capture-1', date: '2026-10-03', text: 'Проверочная запись' }
it('saves exactly one entry for concurrent clicks and a retry after lost native acknowledgement', async () => {
  const results = await Promise.all([saveOverlayEntry(pending, database), saveOverlayEntry(pending, database)])
  expect(results[0].id).toBe(results[1].id)
  await saveOverlayEntry({ ...pending, text: 'Поздняя повторная отправка' }, database)
  expect(await database.journalEntries.count()).toBe(1)
  expect((await database.journalEntries.toArray())[0].text).toBe(pending.text)
  expect(await database.journalDrafts.count()).toBe(0)
})
it('entry and receipt roll back together when storage fails', async () => {
  const fail = () => { throw new Error('storage unavailable') }
  database.kv.hook('creating', fail)
  await expect(saveOverlayEntry(pending, database)).rejects.toThrow('storage unavailable')
  expect(await database.journalEntries.count()).toBe(0)
  database.kv.hook('creating').unsubscribe(fail)
  await saveOverlayEntry(pending, database)
  expect(await database.journalEntries.count()).toBe(1)
})
it('a transcript already inserted into a journal draft cannot also create an overlay entry', async () => {
  await insertWakeDraft({ id: 'draft', date: pending.date, text: '', mood: null }, 'text', pending.text, pending.sessionId, database)
  expect(await saveOverlayEntry(pending, database)).toMatchObject({ id: 'draft', created: false })
  expect(await database.journalEntries.count()).toBe(0)
  expect((await database.journalDrafts.get('draft'))?.text).toBe(pending.text)
})
it('does not overwrite an unrelated record with a colliding imported ID', async () => {
  await database.journalEntries.put({ id: 'wake-capture-1', date: pending.date, text: 'Existing', mood: null, createdAt: 1, updatedAt: 1 })
  await expect(saveOverlayEntry(pending, database)).rejects.toThrow('collision')
  expect((await database.journalEntries.get('wake-capture-1'))?.text).toBe('Existing')
})
it('reopening a committed popup restores the saved text, including later edits in the main diary', async () => {
  expect(await overlayReceipt(pending.sessionId, database)).toBeUndefined()
  const {id} = await saveOverlayEntry({...pending, text: 'Подтверждённый текст'}, database)
  expect(await overlayReceipt(pending.sessionId, database)).toMatchObject({id, text: 'Подтверждённый текст', date: pending.date})
  await database.journalEntries.update(id, {text: 'Исправлено в дневнике'})
  expect(await overlayReceipt(pending.sessionId, database)).toMatchObject({id, text: 'Исправлено в дневнике'})
  await database.journalEntries.delete(id)
  expect(await overlayReceipt(pending.sessionId, database)).toMatchObject({id})
  expect((await saveOverlayEntry(pending, database)).created).toBe(false)
})
