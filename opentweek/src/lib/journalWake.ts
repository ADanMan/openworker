import { db, type OpenTweekDB } from '../db'
import type { JournalDraft, JournalEntry } from '../types'
import { JOURNAL_CONTENT_FIELDS, JOURNAL_TEXT_MAX_LENGTH, saveJournalDraft } from './journal'

/** Draft text and receipt share a transaction: replay after failed native acknowledgement is harmless. */
export async function insertWakeDraft(input: JournalDraft, field: typeof JOURNAL_CONTENT_FIELDS[number], text: string,
  sessionId: string, database: OpenTweekDB = db): Promise<JournalEntry | undefined> {
  if (!sessionId || sessionId.length > 128 || !JOURNAL_CONTENT_FIELDS.includes(field) || !text.trim()) throw new Error('Invalid wake recovery')
  return database.transaction('rw', [database.journalEntries, database.journalDrafts, database.tasks, database.kv], async () => {
    const key = `wake-insert:${sessionId}`
    const previous = await database.kv.get(key)
    if (previous) return undefined // A receipt replay must never replace newer in-memory edits.
    const combined = [input[field]?.trimEnd(), text.trim()].filter(Boolean).join('\n')
    if (combined.length > JOURNAL_TEXT_MAX_LENGTH) throw new Error('Journal field is full')
    const draft = await saveJournalDraft({ ...input, [field]: combined }, database)
    await database.kv.put({ key, value: input.id })
    return draft
  })
}
