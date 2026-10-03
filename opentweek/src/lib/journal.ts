import { db, type OpenTweekDB } from '../db'
import { occurrences } from './recurrence'
import { JOURNAL_EMPTY_FIELDS, type JournalDraft, type JournalEntry } from '../types'
export type { JournalDraft } from '../types'

export const JOURNAL_TEXT_MAX_LENGTH = 100_000
export const JOURNAL_CONTENT_FIELDS = ['text', 'thoughts', 'feelings', 'body', 'perspective', 'action', 'after', 'needs'] as const
export function hasJournalContent(value: Partial<JournalDraft>): boolean {
  return JOURNAL_CONTENT_FIELDS.some(key => typeof value[key] === 'string' && value[key]!.trim().length > 0)
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function validateDraft(value: unknown, allowEmpty = false): JournalDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid journal entry')
  const row = { ...JOURNAL_EMPTY_FIELDS, ...value } as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 200) throw new Error('Invalid journal id')
  if (!validDate(row.date)) throw new Error('Invalid journal date')
  for (const key of JOURNAL_CONTENT_FIELDS) {
    if (typeof row[key] !== 'string' || row[key].length > JOURNAL_TEXT_MAX_LENGTH) throw new Error('Invalid journal text')
  }
  if (row.mood !== null && (!Number.isInteger(row.mood) || (row.mood as number) < 1 || (row.mood as number) > 5)) throw new Error('Invalid journal mood')
  if (row.context !== null && !['work', 'relationships', 'rest', 'change', 'other'].includes(row.context as string)) throw new Error('Invalid journal context')
  if (row.taskId !== null && (typeof row.taskId !== 'string' || !row.taskId.trim() || row.taskId.length > 200)) throw new Error('Invalid journal task')
  for (const key of ['feedId', 'eventUid']) if (row[key] !== null && (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 2000)) throw new Error('Invalid journal feed link')
  if (Boolean(row.feedId) !== Boolean(row.eventUid) || (row.feedId && row.taskId)) throw new Error('Invalid journal link')
  if (row.occurrenceDate !== null && ((!row.taskId && !row.feedId) || !validDate(row.occurrenceDate))) throw new Error('Invalid occurrence date')
  const draft: JournalDraft = { id: row.id, date: row.date, text: row.text as string, mood: row.mood as JournalEntry['mood'] }
  for (const key of Object.keys(JOURNAL_EMPTY_FIELDS)) Object.assign(draft, { [key]: row[key] })
  if (!allowEmpty && !hasJournalContent(draft)) throw new Error('Journal text is empty')
  return draft
}
export function validateJournalEntry(value: unknown): JournalEntry {
  const draft = validateDraft(value)
  const row = value as Record<string, unknown>
  if (!Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0 || !Number.isSafeInteger(row.updatedAt) || (row.updatedAt as number) < (row.createdAt as number)) throw new Error('Invalid journal timestamps')
  return { ...draft, createdAt: row.createdAt as number, updatedAt: row.updatedAt as number }
}
async function save(input: JournalDraft, database: OpenTweekDB, isDraft: boolean): Promise<JournalEntry> {
  const draft = validateDraft(input, isDraft)
  return database.transaction('rw', [database.journalEntries, database.journalDrafts, database.tasks], async () => {
    if (draft.taskId) {
      const task = await database.tasks.get(draft.taskId)
      if (task?.rrule && !draft.occurrenceDate) draft.occurrenceDate = draft.date
      if (!task || (draft.occurrenceDate && (!task.rrule || !occurrences(task, draft.occurrenceDate, draft.occurrenceDate).length))) {
        draft.taskId = null; draft.occurrenceDate = null
      } else if (task.rrule && draft.occurrenceDate) draft.date = draft.occurrenceDate
      else if (!task.rrule) {
        draft.occurrenceDate = null
        draft.date = task.date ?? draft.date
      }
    }
    const table = isDraft ? database.journalDrafts : database.journalEntries
    const previous = await table.get(draft.id)
    const now = Math.max(Date.now(), previous?.updatedAt ?? 0)
    const entry: JournalEntry = { ...draft, createdAt: previous?.createdAt ?? now, updatedAt: now }
    if (!isDraft) for (const key of JOURNAL_CONTENT_FIELDS) entry[key] = entry[key]!.trim()
    await table.put(entry)
    if (!isDraft) await database.journalDrafts.delete(draft.id)
    return entry
  })
}
export const saveJournalEntry = (input: JournalDraft, database: OpenTweekDB = db) => save(input, database, false)
export const saveJournalDraft = (input: JournalDraft, database: OpenTweekDB = db) => save(input, database, true)
export async function deleteJournalEntry(id: string, database: OpenTweekDB = db): Promise<void> { await database.journalEntries.delete(id) }
export async function deleteJournalDraft(id: string, database: OpenTweekDB = db): Promise<void> { await database.journalDrafts.delete(id) }

/** Called within the planner's transaction, so links and task mutations agree. */
export async function updateJournalLinks(taskId: string, patch: Partial<JournalEntry>, occurrenceDate?: string, database: OpenTweekDB = db) {
  for (const table of [database.journalEntries, database.journalDrafts]) {
    await table.where('taskId').equals(taskId).filter(row => occurrenceDate === undefined || row.occurrenceDate === occurrenceDate).modify({ ...patch, updatedAt: Date.now() })
  }
}
