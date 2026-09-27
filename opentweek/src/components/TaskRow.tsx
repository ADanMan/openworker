import { t } from '../i18n'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type KeyboardEvent } from 'react'
import { toggleDone, updateTask } from '../actions'
import { useBoard } from '../board'
import type { ContainerId, Item } from '../types'
import { focusAddLine, removeWithUndo } from '../ui'
import { Icon } from './Icon'

export function TaskRow({ item, container }: { item: Item; container: ContainerId }) {
  const { openItem } = useBoard()
  const [editing, setEditing] = useState(false)
  const { task } = item
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    data: { type: 'item', item, container },
    disabled: editing,
  })

  const commit = async (value: string, next: boolean) => {
    setEditing(false)
    const title = value.trim()
    if (!title) {
      if (!item.occurrence) await removeWithUndo(task.id)
      return
    }
    if (title !== task.title) await updateTask(task.id, { title })
    if (next) focusAddLine(container)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') void commit(e.currentTarget.value, true)
    if (e.key === 'Escape') setEditing(false)
  }

  const doneSubtasks = task.subtasks.filter((s) => s.done).length

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`row color-${task.color}${item.done ? ' done' : ''}${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'Enter' && !e.defaultPrevented) {
          e.preventDefault()
          setEditing(true)
        } else if (e.key === 'e' || e.key === 'o') openItem(item)
        else if (e.key === 'x' || e.key === 'd') void toggleDone(item)
        else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (!item.occurrence) void removeWithUndo(task.id)
        } else listeners?.onKeyDown?.(e)
      }}
    >
      <button
        className="check"
        aria-label={item.done ? t('markNotDone') : t('markDone')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleDone(item)}
      >
        {item.done && <Icon name="check" size={12} />}
      </button>
      {editing ? (
        <input
          className="row-input"
          autoFocus
          defaultValue={task.title}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onBlur={(e) => commit(e.currentTarget.value, false)}
        />
      ) : (
        <span className="title" onClick={() => setEditing(true)} title={task.title}>
          {task.title}
        </span>
      )}
      {!editing && (
        <span className="badges">
          {task.rrule && <Icon name="repeat" size={12} />}
          {task.reminder && (
            <span className="badge-time">
              <Icon name="bell" size={12} />
              {task.reminder}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="badge-count">
              {doneSubtasks}/{task.subtasks.length}
            </span>
          )}
          {task.note && <Icon name="note" size={12} />}
          {task.attachments.length > 0 && <Icon name="clip" size={12} />}
        </span>
      )}
      {!editing && (
        <button
          className="more"
          aria-label={t('openDetails')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => openItem(item)}
        >
          <Icon name="more" size={16} />
        </button>
      )}
    </div>
  )
}

export function TaskRowGhost({ item }: { item: Item }) {
  return (
    <div className={`row ghost color-${item.task.color}${item.done ? ' done' : ''}`}>
      <span className="check">{item.done && <Icon name="check" size={12} />}</span>
      <span className="title">{item.task.title}</span>
    </div>
  )
}
