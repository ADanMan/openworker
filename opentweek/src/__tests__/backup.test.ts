import { afterEach, beforeEach, expect, it } from 'vitest'
import { OpenTweekDB } from '../db'
import { exportBackup, importBackup } from '../lib/backup'
import { JOURNAL_EMPTY_FIELDS } from '../types'
let database: OpenTweekDB
const entry = { id: 'j1', date: '2026-10-03', text: 'A quiet day', mood: 3 as const, createdAt: 1, updatedAt: 2 }
const legacy = { app: 'opentweek', version: 1, exportedAt: '2026-10-03', calendars: [], lists: [], tasks: [], feeds: [] }
beforeEach(async () => {
  database = new OpenTweekDB(`backup-${crypto.randomUUID()}`)
  await database.journalEntries.add(entry)
  await database.calendars.add({ id: 'c1', name: 'Keep', color: 'blue', order: 0 })
})
afterEach(async () => { await database.delete() })
it('roundtrips a v3 journal backup', async () => {
  const backup = await exportBackup(database)
  expect(backup.version).toBe(3)
  expect(backup.journalEntries).toEqual([entry])
  await database.journalEntries.clear()
  await importBackup(backup, database)
  expect(await database.journalEntries.toArray()).toEqual([{ ...JOURNAL_EMPTY_FIELDS, ...entry }])
})
it('restores v1 planner without erasing journal', async () => {
  await importBackup(legacy, database)
  expect(await database.journalEntries.toArray()).toEqual([entry])
  expect(await database.calendars.count()).toBe(0)
})
it.each([undefined, [entry, entry], [{ ...entry, date: '2026-02-30' }], [{ ...entry, mood: 0 }], [{ ...entry, text: ' ' }], [{ ...entry, updatedAt: -1 }], [{ ...entry, createdAt: NaN }], [{ ...entry, id: '' }], [{ ...entry, text: 'x'.repeat(100001) }], [null]])('rejects malformed v2 journal atomically (%#)', async journalEntries => {
  await expect(importBackup({ ...legacy, version: 2, journalEntries }, database)).rejects.toThrow()
  expect(await database.journalEntries.toArray()).toEqual([entry])
  expect(await database.calendars.count()).toBe(1)
})
it('rejects unsupported versions without mutation', async () => {
  await expect(importBackup({ ...legacy, version: 99 }, database)).rejects.toThrow()
  expect(await database.calendars.count()).toBe(1)
})
it('rolls back all stores when planner writes fail', async () => {
  await expect(importBackup({ ...legacy, version: 2, journalEntries: [], calendars: [{ id: 'duplicate' }, { id: 'duplicate' }] }, database)).rejects.toThrow()
  expect(await database.journalEntries.toArray()).toEqual([entry])
  expect(await database.calendars.count()).toBe(1)
})
it('rejects remote attachment URLs before any data changes', async () => {
  await expect(importBackup({ ...legacy, tasks: [{ id: 'remote', attachments: [{ dataUrl: 'https://example.invalid/audio' }] }] }, database)).rejects.toThrow('Invalid backup attachment')
  expect(await database.journalEntries.toArray()).toEqual([entry])
  expect(await database.calendars.count()).toBe(1)
})
it('excludes private drafts and repairs orphan links in v3 and v1 restores', async () => {
  await database.journalDrafts.put({ ...entry, taskId: 'missing' })
  const backup = await exportBackup(database)
  expect(backup).not.toHaveProperty('journalDrafts')
  await importBackup({ ...backup, journalEntries: [{ ...entry, taskId: 'missing' }] }, database)
  expect(await database.journalEntries.get(entry.id)).toMatchObject({ taskId: null, text: entry.text })
  expect(await database.journalDrafts.get(entry.id)).toMatchObject({ taskId: null })
  await database.journalEntries.update(entry.id, { taskId: 'missing' })
  await importBackup(legacy, database)
  expect(await database.journalEntries.get(entry.id)).toMatchObject({ taskId: null, text: entry.text })
})
it('rejects invalid structured fields without replacing planner or drafts', async () => {
  await database.journalDrafts.put(entry)
  await expect(importBackup({ ...legacy, version: 3, journalEntries: [{ ...entry, thoughts: 3 }] }, database)).rejects.toThrow()
  expect(await database.journalDrafts.get(entry.id)).toEqual(entry)
  expect(await database.calendars.count()).toBe(1)
})
