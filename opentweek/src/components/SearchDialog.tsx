import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { fromISODate } from '../lib/dates'
import { describe } from '../lib/recurrence'
import type { SomedayList, Task } from '../types'
import { Dialog } from './Dialog'

export function SearchDialog({
  tasks,
  lists,
  onPick,
  onClose,
}: {
  tasks: Task[]
  lists: SomedayList[]
  onPick: (task: Task) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return tasks
      .filter((t) =>
        [t.title, t.note, ...t.subtasks.map((s) => s.title)].some((s) => s.toLowerCase().includes(needle)),
      )
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 100)
  }, [q, tasks])

  return (
    <Dialog title="Search" onClose={onClose} className="search">
      <input autoFocus className="search-input" placeholder="Search tasks, notes, subtasks…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="results">
        {results.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)} className={t.done ? 'done' : ''}>
              <span className={`dot color-${t.color}`} />
              <span className="title">{t.title || '(untitled)'}</span>
              <span className="muted small">
                {t.date
                  ? format(fromISODate(t.date), 'EEE d MMM yyyy') + (t.rrule ? ` · ${describe(t)}` : '')
                  : `Someday · ${lists.find((l) => l.id === t.listId)?.name ?? ''}`}
              </span>
            </button>
          </li>
        ))}
        {q && !results.length && <li className="muted">Nothing found</li>}
      </ul>
    </Dialog>
  )
}
