import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, uid } from '../db'
import { deleteJournalDraft, deleteJournalEntry, hasJournalContent, JOURNAL_TEXT_MAX_LENGTH, saveJournalDraft, saveJournalEntry, type JournalDraft } from '../lib/journal'
import { CONTEXTS, getGuidance, JOURNAL_FIELDS } from '../lib/journalGuidance'
import { j } from '../lib/journalCopy'
import { expand } from '../lib/recurrence'
import type { Feed, JournalEntry, Task } from '../types'
import { LocalDictation } from './LocalDictation'

export interface JournalTarget { taskId?: string | null; occurrenceDate?: string | null; feedId?: string | null; eventUid?: string | null }
const fresh = (date: string, target: JournalTarget = {}): JournalDraft => ({ id: uid(), date, text: '', mood: null, ...target })
const matches = (entry: JournalDraft, target: JournalTarget) => target.taskId
  ? entry.taskId === target.taskId && (entry.occurrenceDate ?? null) === (target.occurrenceDate ?? null)
  : target.feedId ? entry.feedId === target.feedId && entry.eventUid === target.eventUid && entry.occurrenceDate === target.occurrenceDate : false
const preview = (entry: JournalDraft) => entry.text || entry.feelings || entry.thoughts || entry.needs || 'Запись без описания ситуации'

export function JournalPage({ date, calendarId, target, onDate, onOpenTask, onOpenFeed }: {
  date: string; calendarId: string; target?: JournalTarget; onDate: (date: string) => void
  onOpenTask: (task: Task, occurrenceDate: string | null) => void; onOpenFeed: (date: string) => void
}) {
  const entries = useLiveQuery(() => db.journalEntries.where('date').equals(date).reverse().sortBy('updatedAt'), [date])
  const drafts = useLiveQuery(() => db.journalDrafts.where('date').equals(date).toArray(), [date])
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? []
  const feeds = useLiveQuery(() => db.feeds.toArray(), []) ?? []
  const [editor, setEditor] = useState<{ draft: JournalDraft; saved: JournalEntry | null; revision: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)
  // The parent keys this page by selected day and explicit target. Reading never mutates a saved entry.
  useEffect(() => {
    let cancelled = false
    const request = ++revision.current
    const load = async () => {
      const [saved, pending] = await Promise.all([db.journalEntries.where('date').equals(date).toArray(), db.journalDrafts.where('date').equals(date).toArray()])
      const selected = target ? saved.find((e) => matches(e, target)) : undefined
      const draft = target ? pending.find((e) => matches(e, target)) : pending.sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!cancelled && request === revision.current) setEditor({ draft: draft ?? selected ?? fresh(date, target), saved: selected ?? (draft ? saved.find((e) => e.id === draft.id) ?? null : null), revision: request })
    }
    void load().catch(() => !cancelled && setError('Не удалось открыть дневник. Попробуйте вернуться к календарю и открыть его снова.'))
    return () => { cancelled = true }
  }, [date, target])
  const choose = async (entry: JournalEntry, isDraft = false) => {
    if (busy) return
    const request = ++revision.current
    try {
      const pending = isDraft ? entry : await db.journalDrafts.get(entry.id)
      const saved = isDraft ? await db.journalEntries.get(entry.id) : entry
      if (request === revision.current) setEditor({ draft: pending ?? entry, saved: saved ?? null, revision: request })
    } catch { if (request === revision.current) setError(j('saveFailed')) }
  }
  const dayItems = expand(tasks.filter((t) => t.calendarId === calendarId), date, date).filter((i) => i.date === date)
  return <main className="journal-page" aria-label="Дневник чувств">
    <div className="journal-heading"><div><h2>Дневник чувств</h2><p>Можно записать пару слов или пройти по шагам. Все поля необязательны.</p></div>
      <label className="field"><span>Выбранная дата</span><input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} /></label>
    </div>
    <div className="journal-layout">
      <aside className="journal-list">
        <button className="btn primary" disabled={busy} onClick={() => setEditor({ draft: fresh(date), saved: null, revision: ++revision.current })}>Новая запись</button>
        <h3>Записи за день</h3>
        {!entries?.length && <p className="journal-hint">Пока нет сохранённых записей.</p>}
        {entries?.map((entry) => <button className={`journal-entry${editor?.draft.id === entry.id ? ' selected' : ''}`} disabled={busy} key={entry.id} onClick={() => void choose(entry)}>
          <time>{entry.date}</time><span>{preview(entry).slice(0, 90)}</span>
        </button>)}
        {!!drafts?.length && <><h3>Черновики</h3>{drafts.map((draft) => <button className="journal-entry journal-draft" disabled={busy} key={draft.id} onClick={() => void choose(draft, true)}><span>{preview(draft).slice(0, 90)}</span><small>Не завершено</small></button>)}</>}
        <h3>События календаря</h3>
        {!dayItems.length && <p className="journal-hint">В выбранном календаре нет задач на этот день.</p>}
        {dayItems.map((item) => <button className="journal-day-task" disabled={busy} key={item.key} onClick={async () => {
          const link = { taskId: item.task.id, occurrenceDate: item.occurrence ? date : null }
          const existing = entries?.find((e) => matches(e, link))
          const pending = drafts?.find((e) => matches(e, link))
          if (pending) await choose(pending, true)
          else if (existing) await choose(existing)
          else setEditor({ draft: fresh(date, link), saved: null, revision: ++revision.current })
        }}>{item.task.title}<span> → запись</span></button>)}
        <p className="journal-hint">Дневник общий для ваших календарей. Записи не включаются в ссылки на задачи и ICS.</p>
      </aside>
      {editor && <JournalEditor key={editor.revision} initial={editor.draft} saved={editor.saved} tasks={tasks} feeds={feeds}
        onBusy={setBusy} onOpenTask={onOpenTask} onOpenFeed={onOpenFeed}
        onRemoved={() => setEditor({ draft: fresh(date), saved: null, revision: ++revision.current })} />}
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="journal-hint journal-privacy">{j('privacy')} Черновики сохраняются локально, отдельно от завершённых записей.</p>
  </main>
}

function JournalEditor({ initial, saved, tasks, feeds, onBusy, onOpenTask, onOpenFeed, onRemoved }: {
  initial: JournalDraft; saved: JournalEntry | null; tasks: Task[]; feeds: Feed[]; onBusy: (busy: boolean) => void
  onOpenTask: (task: Task, date: string | null) => void; onOpenFeed: (date: string) => void; onRemoved: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const latest = useRef(initial)
  const [baseline, setBaseline] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [guided, setGuided] = useState(false)
  const [voiceField, setVoiceField] = useState('text')
  const queue = useRef(Promise.resolve())
  const operation = useRef(false)
  const writeRevision = useRef(0)
  const task = tasks.find((t) => t.id === draft.taskId)
  const feed = feeds.find((f) => f.id === draft.feedId)
  const event = feed?.events.find((e) => e.uid === draft.eventUid && e.date === draft.occurrenceDate)
  const guidance = getGuidance(draft.context ?? undefined)
  useEffect(() => { onBusy(busy || saving); return () => onBusy(false) }, [busy, saving, onBusy])
  const change = (next: JournalDraft) => {
    latest.current = next; setDraft(next); setError(''); setStatus('Сохраняем черновик…')
    const rev = ++writeRevision.current
    queue.current = queue.current.catch(() => {}).then(async () => {
      try { await saveJournalDraft(next); if (rev === writeRevision.current) setStatus('Черновик сохранён на устройстве') }
      catch { if (rev === writeRevision.current) setError('Не удалось сохранить черновик. Не закрывайте страницу; попробуйте сохранить запись.') }
    })
  }
  const save = async () => {
    if (busy || operation.current || !hasJournalContent(latest.current)) return
    operation.current = true; setSaving(true); setError('')
    try {
      await queue.current
      const entry = await saveJournalEntry(latest.current)
      latest.current = entry; setDraft(entry); setBaseline(entry); setStatus(j('saved'))
    } catch { setError(j('saveFailed')) }
    finally { operation.current = false; setSaving(false) }
  }
  const discard = async () => {
    if (busy || operation.current || !window.confirm('Удалить черновик изменений? Сохранённая запись останется прежней.')) return
    operation.current = true; setSaving(true)
    try { await queue.current; await deleteJournalDraft(draft.id); if (baseline) { latest.current = baseline; setDraft(baseline); setStatus('Изменения отменены') } else onRemoved() }
    catch { setError('Не удалось отменить изменения. Попробуйте ещё раз.') }
    finally { operation.current = false; setSaving(false) }
  }
  const remove = async () => {
    if (busy || operation.current || !window.confirm(j('deleteConfirm'))) return
    operation.current = true; setSaving(true)
    try { await queue.current; await deleteJournalEntry(draft.id); await deleteJournalDraft(draft.id); onRemoved() }
    catch { setError(j('deleteFailed')) }
    finally { operation.current = false; setSaving(false) }
  }
  const append = (key: string, text: string) => {
    const current = latest.current
    const old = current[key as keyof JournalDraft]
    change({ ...current, [key]: [typeof old === 'string' ? old.trimEnd() : '', text].filter(Boolean).join('\n').slice(0, JOURNAL_TEXT_MAX_LENGTH) })
  }
  return <section className="journal-editor" aria-label="Редактор дневника">
    {(draft.taskId || draft.feedId) && <div className="journal-link">
      <strong>Связано с событием</strong>
      {task ? <button className="btn" disabled={busy || saving} onClick={() => onOpenTask(task, draft.occurrenceDate ?? null)}>{task.title} → календарь</button>
        : event ? <button className="btn" disabled={busy || saving} onClick={() => onOpenFeed(event.date)}>{event.title} → календарь</button>
          : <p>Событие больше недоступно. Текст дневника сохранён.</p>}
      <button className="btn subtle" disabled={busy || saving} onClick={() => change({ ...draft, taskId: null, occurrenceDate: null, feedId: null, eventUid: null })}>Убрать связь</button>
    </div>}
    <label className="field"><span>{j('text')}</span><small>Ситуация или свободная запись</small>
      <textarea rows={5} maxLength={JOURNAL_TEXT_MAX_LENGTH} value={draft.text} disabled={busy || saving} placeholder="Что произошло? Можно описать только то, что хочется сохранить."
        onChange={(e) => change({ ...draft, text: e.target.value })} /></label>
    <button className="btn guidance-toggle" aria-expanded={guided} onClick={() => setGuided(!guided)}>{guided ? 'Свернуть помощь' : 'Помочь заполнить по шагам'}</button>
    <div className="journal-steps" hidden={!guided}>
      <p>Подсказки выбираются по указанной вами ситуации. Приложение не определяет ваши чувства по тексту. Выбирайте только то, что подходит, или пропускайте.</p>
      <label className="field"><span>О чём ситуация?</span><select value={draft.context ?? ''} disabled={busy || saving} onChange={(e) => change({ ...draft, context: (e.target.value || null) as JournalDraft['context'] })}>
        <option value="">Не выбирать</option>{CONTEXTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select></label>
      <div className="journal-guidance"><small>{guidance.reason}</small>{guidance.prompts.map((p) => <p key={p}>{p}</p>)}</div>
      {JOURNAL_FIELDS.map(({ key, label, prompt }) => <div className="journal-step" key={key}>
        <label className="field"><span>{label}</span><small>{prompt} Можно оставить пустым.</small>
          <textarea rows={2} maxLength={JOURNAL_TEXT_MAX_LENGTH} value={draft[key] ?? ''} disabled={busy || saving} onChange={(e) => change({ ...draft, [key]: e.target.value })} />
        </label>
        {(key === 'feelings' || key === 'needs') && <div className="journal-choices" aria-label={key === 'feelings' ? 'Возможные чувства' : 'Возможные потребности'}>
          {(key === 'feelings' ? guidance.feelings : guidance.needs).map((word) => <button className="btn" key={word} disabled={busy || saving} onClick={() => append(key, word)}>{word}</button>)}
        </div>}
      </div>)}
    </div>
    {!guided && JOURNAL_FIELDS.some(({ key }) => draft[key]?.trim()) && <p className="journal-hint">В записи есть заполненные разделы. Откройте помощь, чтобы их увидеть.</p>}
    <label className="field"><span>{j('mood')}</span><select value={draft.mood ?? ''} disabled={busy || saving} onChange={(e) => change({ ...draft, mood: e.target.value ? Number(e.target.value) as JournalEntry['mood'] : null })}>
      <option value="">{j('noMood')}</option>{([1, 2, 3, 4, 5] as const).map((m) => <option key={m} value={m}>{m} — {j(`mood${m}`)}</option>)}
    </select></label>
    <label className="field"><span>Куда вставить диктовку</span><select value={voiceField} disabled={busy || saving} onChange={(e) => setVoiceField(e.target.value)}>
      <option value="text">Ситуация / свободная запись</option>{JOURNAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select></label>
    <LocalDictation onBusy={setBusy} onText={(text) => append(voiceField, text)} />
    <p className="journal-hint">Автосохранение сохраняет только черновик. «Сохранить запись» завершает его. Переключение режима остановит микрофон.</p>
    {error && <p className="journal-error" role="alert">{error}</p>}{status && <p className="journal-save-status" role="status">{status}</p>}
    <div className="modal-actions">
      <button className="btn primary" disabled={busy || saving || !hasJournalContent(draft)} onClick={save}>{saving ? j('saving') : j('save')}</button>
      <button className="btn" disabled={busy || saving} onClick={discard}>Отменить изменения</button>
      {baseline && <button className="btn danger" disabled={busy || saving} onClick={remove}>{j('delete')}</button>}
    </div>
  </section>
}
