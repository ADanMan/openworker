import { fmt, t } from '../i18n'
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
      .filter((task) =>
        [task.title, task.note, ...task.subtasks.map((s) => s.title)].some((s) => s.toLowerCase().includes(needle)),
      )
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 100)
  }, [q, tasks])

  return (
    <Dialog title={t('search')} onClose={onClose} className="search">
      <input autoFocus className="search-input" placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="results">
        {results.map((task) => (
          <li key={task.id}>
            <button onClick={() => onPick(task)} className={task.done ? 'done' : ''}>
              <span className={`dot color-${task.color}`} />
              <span className="title">{task.title || t('untitled')}</span>
              <span className="muted small">
                {task.date
                  ? fmt(fromISODate(task.date), 'EEE d MMM yyyy') + (task.rrule ? ` · ${describe(task)}` : '')
                  : `${t('someday')} · ${lists.find((l) => l.id === task.listId)?.name ?? ''}`}
              </span>
            </button>
          </li>
        ))}
        {q && !results.length && <li className="muted">{t('nothingFound')}</li>}
      </ul>
    </Dialog>
  )
}
