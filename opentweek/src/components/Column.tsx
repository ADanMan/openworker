import { t } from '../i18n'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useState, type ReactNode } from 'react'
import { addTask } from '../actions'
import { useBoard } from '../board'
import type { ContainerId } from '../types'
import { TaskRow } from './TaskRow'

function AddLine({ container }: { container: ContainerId }) {
  const { calendarId } = useBoard()
  const [value, setValue] = useState('')
  const submit = async () => {
    if (!value.trim()) return
    setValue('')
    await addTask(calendarId, container, value)
  }
  return (
    <div
      className="add-area"
      onClick={(e) => (e.currentTarget.firstElementChild as HTMLInputElement | null)?.focus()}
    >
      <input
        className="add-line"
        data-add={container}
        value={value}
        aria-label={t('addTask')}
        placeholder={`+ ${t('addTask')}`}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            setValue('')
            e.currentTarget.blur()
          }
        }}
        onBlur={submit}
      />
    </div>
  )
}

export function Column({
  container,
  header,
  className = '',
  date,
}: {
  container: ContainerId
  header: ReactNode
  className?: string
  date?: string
}) {
  const board = useBoard()
  const items = board.items(container)
  const events = date ? board.events(date) : []
  const { setNodeRef } = useDroppable({ id: container, data: { type: 'container', container } })
  return (
    <section ref={setNodeRef} className={`column ${className}${board.overContainer === container ? ' over' : ''}`}>
      {header}
      {date && <button className="day-journal" aria-label={`Дневник за ${date}`} onClick={() => board.openJournal(date)}>Дневник</button>}
      <div className="lines">
        {events.map((ev) => (
          <div key={ev.uid} className={`event color-${ev.color}`} title={ev.location ?? undefined}>
            {ev.time && <span className="event-time">{ev.time}</span>}
            <button className="title event-journal" title="Открыть дневник события" onClick={() => board.openJournal(date!, { feedId: ev.feedId, eventUid: ev.uid, occurrenceDate: date })}>{ev.title}</button>
          </div>
        ))}
        <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <TaskRow key={item.key} item={item} container={container} />
          ))}
        </SortableContext>
        <AddLine container={container} />
      </div>
    </section>
  )
}
