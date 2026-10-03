import { db, type OpenTweekDB } from '../db'
import type { JournalDraft, JournalEntry } from '../types'
import { JOURNAL_CONTENT_FIELDS, JOURNAL_TEXT_MAX_LENGTH, saveJournalDraft, saveJournalEntry } from './journal'

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

/** A user-confirmed overlay result creates a new entry; its receipt is shared with draft insertion. */
export async function overlayReceipt(sessionId: string, database: OpenTweekDB = db): Promise<{ id: string; text?: string; date?: string } | undefined> {
  return database.transaction('r', [database.kv, database.journalEntries, database.journalDrafts], async () => {
    const receipt = await database.kv.get(`wake-insert:${sessionId}`)
    if (!receipt) return undefined
    const id = String(receipt.value)
    const entry = await database.journalEntries.get(id) || await database.journalDrafts.get(id)
    return { id, text: entry?.text, date: entry?.date }
  })
}

export async function saveOverlayEntry(input: { sessionId: string; date: string; text: string }, database: OpenTweekDB = db): Promise<{ id: string; created: boolean }> {
  if (!input.sessionId || input.sessionId.length > 128 || !input.text.trim()) throw new Error('Invalid overlay result')
  return database.transaction('rw', [database.journalEntries, database.journalDrafts, database.tasks, database.kv], async () => {
    const key = `wake-insert:${input.sessionId}`
    const receipt = await database.kv.get(key)
    if (receipt) return { id: String(receipt.value), created: false }
    const id = `wake-${input.sessionId}`
    if (await database.journalEntries.get(id) || await database.journalDrafts.get(id)) throw new Error('Overlay entry ID collision')
    await saveJournalEntry({ id, date: input.date, text: input.text, mood: null }, database)
    await database.kv.put({ key, value: id })
    return { id, created: true }
  })
}
