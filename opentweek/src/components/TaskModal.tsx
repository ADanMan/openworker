import { toISODate } from '../lib/dates'
import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { detachOccurrence, duplicateTask, skipOccurrence, toggleDone, updateTask } from '../actions'
import { uid } from '../db'
import { toast } from '../hooks/toast'
import { shareSummary, shareUrl, toShared } from '../lib/share'
import { isNative, saveFile, shareText } from '../native'
import { COLORS, type Item, type SomedayList, type Subtask } from '../types'
import { Icon } from './Icon'
import { RepeatEditor } from './RepeatEditor'
import { removeWithUndo } from '../ui'

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`)

function AttachmentLink({ blob, name }: { blob: Blob; name: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return blob.type.startsWith('image/') ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={name} className="thumb" />
    </a>
  ) : (
    <a
      href={url}
      download={name}
      onClick={(e) => {
        if (!isNative) return
        e.preventDefault()
        void saveFile(name, blob, blob.type)
      }}
    >
      {name}
    </a>
  )
}

export function TaskModal({ item, lists, onClose, onOpenJournal }: { item: Item; lists: SomedayList[]; onClose: () => void; onOpenJournal?: () => void }) {
  const { task } = item
  const dialog = useRef<HTMLDialogElement>(null)
  const [newSub, setNewSub] = useState('')
  const set = (patch: Parameters<typeof updateTask>[1]) => updateTask(task.id, patch)
  const setSubtasks = (subtasks: Subtask[]) => set({ subtasks })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const where = task.date ? 'day' : `list:${task.listId}`

  return (
    <dialog
      ref={dialog}
      className="modal task-modal"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
    >
      <div className="modal-body">
        <div className="modal-top">
          <button
            className={`check big${item.done ? ' on' : ''}`}
            aria-label={t('toggleDone')}
            onClick={() => toggleDone({ ...item, done: item.done })}
          >
            {item.done && <Icon name="check" size={14} />}
          </button>
          <input
            className="title-input"
            defaultValue={task.title}
            key={task.id}
            placeholder={t('task')}
            onChange={(e) => set({ title: e.target.value })}
          />
          <button className="icon-btn" aria-label={t('close')} onClick={() => dialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>

        {item.occurrence && (
          <div className="banner">
            <Icon name="repeat" size={14} /> {t('repeatingBanner')}
            <span className="banner-actions">
              <button onClick={() => skipOccurrence(item).then(() => dialog.current?.close())}>{t('skipThis')}</button>
              <button
                onClick={() =>
                  detachOccurrence(item, { date: item.date, listId: null }).then(() => dialog.current?.close())
                }
              >
                {t('editOnlyThis')}
              </button>
            </span>
          </div>
        )}

        {onOpenJournal && <button className="btn task-journal-open" onClick={onOpenJournal}>Открыть дневник события</button>}
        <div className="field-row">
          <label className="field">
            <span>{t('when')}</span>
            <select
              value={where}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'day') set({ date: item.date ?? toISODate(new Date()), listId: null })
                else set({ date: null, listId: v.slice(5), rrule: null, reminder: null })
              }}
            >
              <option value="day">{t('onADay')}</option>
              {lists.map((l) => (
                <option key={l.id} value={`list:${l.id}`}>
                  {t('somedayList', { name: l.name })}
                </option>
              ))}
            </select>
            {task.date && (
              <input
                type="date"
                value={item.occurrence ? task.date : (task.date ?? '')}
                onChange={(e) => e.target.value && set({ date: e.target.value })}
                title={item.occurrence ? t('seriesStart') : undefined}
              />
            )}
          </label>
          <label className="field">
            <span>{t('reminder')}</span>
            <input
              type="time"
              disabled={!task.date}
              value={task.reminder ?? ''}
              onChange={(e) => set({ reminder: e.target.value || null })}
            />
          </label>
        </div>

        <div className="field">
          <span>{t('color')}</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch color-${c}${task.color === c ? ' on' : ''}`}
                aria-label={c}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span>{t('repeat')}</span>
          <RepeatEditor
            date={task.date}
            rrule={task.rrule}
            onChange={(rrule) => set({ rrule, exdates: rrule ? task.exdates : [], doneDates: rrule ? task.doneDates : [] })}
          />
        </div>

        <div className="field">
          <span>{t('subtasks')}</span>
          <ul className="subtasks">
            {task.subtasks.map((s) => (
              <li key={s.id} className={s.done ? 'done' : ''}>
                <button
                  className={`check${s.done ? ' on' : ''}`}
                  aria-label={t('toggleSubtask')}
                  onClick={() => setSubtasks(task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
                >
                  {s.done && <Icon name="check" size={12} />}
                </button>
                <input
                  defaultValue={s.title}
                  onBlur={(e) =>
                    setSubtasks(task.subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  className="icon-btn subtle"
                  aria-label={t('removeSubtask')}
                  onClick={() => setSubtasks(task.subtasks.filter((x) => x.id !== s.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
            <li>
              <span className="check placeholder" />
              <input
                placeholder={t('addSubtask')}
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSub.trim()) {
                    setSubtasks([...task.subtasks, { id: uid(), title: newSub.trim(), done: false }])
                    setNewSub('')
                  }
                }}
              />
            </li>
          </ul>
        </div>

        <label className="field">
          <span>{t('notes')}</span>
          <textarea
            key={task.id}
            defaultValue={task.note}
            rows={4}
            placeholder={t('addNote')}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>

        <div className="field">
          <span>{t('attachments')}</span>
          <ul className="attachments">
            {task.attachments.map((a) => (
              <li key={a.id}>
                <AttachmentLink blob={a.blob} name={a.name} />
                <span className="muted small">{fmtSize(a.size)}</span>
                <button
                  className="icon-btn subtle"
                  aria-label={t('removeAttachment')}
                  onClick={() => set({ attachments: task.attachments.filter((x) => x.id !== a.id) })}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <label className="btn file-btn">
            <Icon name="clip" size={14} /> {t('attachFiles')}
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                void set({
                  attachments: [
                    ...task.attachments,
                    ...files.map((f) => ({ id: uid(), name: f.name, type: f.type, size: f.size, blob: f as Blob })),
                  ],
                })
              }}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            onClick={async () => {
              const shared = toShared(task)
              const url = await shareUrl({ v: 1, title: task.title, tasks: [shared] }, isNative)
              // Browser: copy just the link. Android: share sheet with a readable summary (+ link if hosted).
              const text = !isNative && url ? url : [shareSummary(shared), url].filter(Boolean).join('\n\n')
              const how = await shareText(task.title, text)
              if (how === 'copied') toast(t('shareCopied'))
            }}
          >
            <Icon name="share" size={14} /> {t('share')}
          </button>
          <button className="btn" onClick={() => duplicateTask(task).then(() => toast(t('duplicated')))}>
            <Icon name="copy" size={14} /> {t('duplicate')}
          </button>
          <span className="spacer" />
          <button
            className="btn danger"
            onClick={() => {
              void removeWithUndo(task.id)
              dialog.current?.close()
            }}
          >
            <Icon name="trash" size={14} /> {task.rrule ? t('deleteSeries') : t('delete')}
          </button>
        </div>
      </div>
    </dialog>
  )
}
