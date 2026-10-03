import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db, uid } from '../db'
import { toISODate } from '../lib/dates'
import { deleteJournalEntry, JOURNAL_TEXT_MAX_LENGTH, saveJournalEntry } from '../lib/journal'
import { j } from '../lib/journalCopy'
import type { JournalEntry } from '../types'
import { Dialog } from './Dialog'
import { LocalDictation } from './LocalDictation'

type Draft = Pick<JournalEntry, 'id' | 'date' | 'text' | 'mood'>
const freshDraft = (): Draft => ({ id: uid(), date: toISODate(new Date()), text: '', mood: null })
const signature = (draft: Draft) => JSON.stringify([draft.date, draft.text, draft.mood])

export function JournalDialog({ onClose }: { onClose: () => void }) {
  const entries = useLiveQuery(() => db.journalEntries.orderBy('date').reverse().toArray(), [])
  const [draft, setDraft] = useState(freshDraft)
  const [baseline, setBaseline] = useState(() => signature(draft))
  const [savedId, setSavedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const dirty = signature(draft) !== baseline
  const canLeave = () => !savingRef.current && (!dirty || window.confirm(j('discard')))
  const select = (next: Draft, exists: boolean) => {
    if (busy || !canLeave()) return
    setDraft(next); setBaseline(signature(next)); setSavedId(exists ? next.id : ''); setMessage(''); setError('')
  }
  const save = async () => {
    if (busy || savingRef.current || !draft.text.trim()) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      const saved = await saveJournalEntry(draft)
      setDraft(saved); setBaseline(signature(saved)); setSavedId(saved.id); setMessage(j('saved'))
    } catch { setError(j('saveFailed')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const remove = async () => {
    if (busy || savingRef.current || !savedId || !window.confirm(j('deleteConfirm'))) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      await deleteJournalEntry(savedId)
      const next = freshDraft(); setDraft(next); setBaseline(signature(next)); setSavedId(''); setMessage('')
    } catch { setError(j('deleteFailed')) }
    finally { savingRef.current = false; setSaving(false) }
  }

  return <Dialog title={j('journal')} onClose={onClose} canClose={canLeave} className="journal-modal">
    <div className="journal-layout">
      <aside className="journal-list">
        <button className="btn" disabled={busy || saving} onClick={() => select(freshDraft(), false)}>{j('newEntry')}</button>
        {entries?.length === 0 && <p className="journal-hint">{j('empty')}</p>}
        {entries?.map((entry) => <button key={entry.id} disabled={busy || saving}
          className={`journal-entry${draft.id === entry.id ? ' selected' : ''}`}
          onClick={() => select(entry, true)}>
          <time dateTime={entry.date}>{entry.date}</time>
          <span>{entry.text.slice(0, 100)}</span>
        </button>)}
      </aside>
      <section className="journal-editor">
        <label className="field"><span>{j('date')}</span><input type="date" value={draft.date} disabled={busy || saving}
          onChange={(e) => { setDraft({ ...draft, date: e.target.value }); setMessage('') }} /></label>
        <label className="field"><span>{j('text')}</span>
          <textarea rows={7} maxLength={JOURNAL_TEXT_MAX_LENGTH} placeholder={j('placeholder')}
            value={draft.text} disabled={busy || saving} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); setMessage('') }} />
        </label>
        <label className="field"><span>{j('mood')}</span>
          <select value={draft.mood ?? ''} disabled={busy || saving} onChange={(e) => { setDraft({ ...draft, mood: e.target.value ? Number(e.target.value) as JournalEntry['mood'] : null }); setMessage('') }}>
            <option value="">{j('noMood')}</option>
            {([1, 2, 3, 4, 5] as const).map((mood) => <option key={mood} value={mood}>{mood} — {j(`mood${mood}`)}</option>)}
          </select>
        </label>
        <LocalDictation key={draft.id} onBusy={setBusy} onText={(text) => {
          setDraft((current) => ({ ...current, text: [current.text.trimEnd(), text].filter(Boolean).join('\n').slice(0, JOURNAL_TEXT_MAX_LENGTH) }))
          setMessage('')
        }} />
        <p className="journal-hint">{j('draft')}</p>
        {error && <p className="journal-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="modal-actions">
          <button className="btn primary" disabled={busy || saving || !draft.text.trim() || !draft.date} onClick={save}>{saving ? j('saving') : j('save')}</button>
          {savedId && <button className="btn danger" disabled={busy || saving} onClick={remove}>{j('delete')}</button>}
        </div>
      </section>
    </div>
    <p className="journal-hint journal-privacy">{j('privacy')}</p>
  </Dialog>
}
