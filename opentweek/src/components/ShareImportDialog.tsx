import { t } from '../i18n'
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
    <Dialog title={t('sharedWithYou')} onClose={onClose}>
      <ul className="results">
        {payload.tasks.map((task, i) => (
          <li key={i}>
            <span className={`dot color-${task.color}`} /> <strong>{task.title}</strong>{' '}
            <span className="muted small">{task.date ?? t('someday')}</span>
            {task.note && <p className="muted small pre">{task.note}</p>}
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          {t('dismiss')}
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            const firstList = (await db.lists.where('calendarId').equals(calendarId).sortBy('order'))[0]
            await db.tasks.bulkAdd(
              payload.tasks.map((task, i) =>
                newTask({
                  calendarId,
                  title: task.title,
                  note: task.note,
                  color: task.color,
                  date: task.date,
                  listId: task.date ? null : (firstList?.id ?? null),
                  rrule: task.date ? task.rrule : null,
                  subtasks: task.subtasks.map((s) => ({ ...s, id: uid() })),
                  order: Date.now() + i,
                }),
              ),
            )
            toast(t('added', { n: payload.tasks.length }))
            onClose()
          }}
        >
          {t('addToCalendar')}
        </button>
      </div>
    </Dialog>
  )
}
