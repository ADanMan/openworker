import { db, type OpenTweekDB } from '../db'
import type { JournalEntry } from '../types'

export const JOURNAL_TEXT_MAX_LENGTH = 100_000
export type JournalDraft = Pick<JournalEntry, 'id' | 'date' | 'text' | 'mood'>

/** Validate untrusted imports as well as drafts without guessing a mood or date. */
function validateDraft(value: unknown): JournalDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid journal entry')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 200) throw new Error('Invalid journal id')
  if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('Invalid journal date')
  const parsed = new Date(`${row.date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.date) throw new Error('Invalid journal date')
  if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > JOURNAL_TEXT_MAX_LENGTH) throw new Error('Journal text is empty or too long')
  if (row.mood !== null && (!Number.isInteger(row.mood) || (row.mood as number) < 1 || (row.mood as number) > 5)) throw new Error('Invalid journal mood')
  return { id: row.id, date: row.date, text: row.text, mood: row.mood as JournalEntry['mood'] }
}

export function validateJournalEntry(value: unknown): JournalEntry {
  const draft = validateDraft(value)
  const row = value as Record<string, unknown>
  if (!Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0 || !Number.isSafeInteger(row.updatedAt) || (row.updatedAt as number) < (row.createdAt as number)) throw new Error('Invalid journal timestamps')
  return { ...draft, createdAt: row.createdAt as number, updatedAt: row.updatedAt as number }
}

export async function saveJournalEntry(input: JournalDraft, database: OpenTweekDB = db): Promise<JournalEntry> {
  const draft = validateDraft(input)
  return database.transaction('rw', database.journalEntries, async () => {
    const previous = await database.journalEntries.get(draft.id)
    const now = Math.max(Date.now(), previous?.updatedAt ?? 0)
    const entry: JournalEntry = { ...draft, text: draft.text.trim(), createdAt: previous?.createdAt ?? now, updatedAt: now }
    await database.journalEntries.put(entry)
    return entry
  })
}

export async function deleteJournalEntry(id: string, database: OpenTweekDB = db): Promise<void> {
  await database.journalEntries.delete(id)
}
