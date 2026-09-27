import { newTask } from '../actions'
import { db, uid } from '../db'
import { toast } from '../hooks/toast'
import type { SharePayload } from '../lib/share'
import { Dialog } from './Dialog'

export function ShareImportDialog({
  payload,
  calendarId,
  onClose,
}: {
  payload: SharePayload
  calendarId: string
  onClose: () => void
}) {
  return (
    <Dialog title="Shared with you" onClose={onClose}>
      <ul className="results">
        {payload.tasks.map((t, i) => (
          <li key={i}>
            <span className={`dot color-${t.color}`} /> <strong>{t.title}</strong>{' '}
            <span className="muted small">{t.date ?? 'Someday'}</span>
            {t.note && <p className="muted small pre">{t.note}</p>}
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Dismiss
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            const firstList = (await db.lists.where('calendarId').equals(calendarId).sortBy('order'))[0]
            await db.tasks.bulkAdd(
              payload.tasks.map((t, i) =>
                newTask({
                  calendarId,
                  title: t.title,
                  note: t.note,
                  color: t.color,
                  date: t.date,
                  listId: t.date ? null : (firstList?.id ?? null),
                  rrule: t.date ? t.rrule : null,
                  subtasks: t.subtasks.map((s) => ({ ...s, id: uid() })),
                  order: Date.now() + i,
                }),
              ),
            )
            toast(`Added ${payload.tasks.length} task(s)`)
            onClose()
          }}
        >
          Add to my calendar
        </button>
      </div>
    </Dialog>
  )
}
