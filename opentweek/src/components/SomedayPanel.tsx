import { useState } from 'react'
import { addList, deleteList, listContainer } from '../actions'
import { useBoard } from '../board'
import { db } from '../db'
import type { SomedayList } from '../types'
import { Column } from './Column'
import { Icon } from './Icon'

function ListHeader({ list }: { list: SomedayList }) {
  const [editing, setEditing] = useState(false)
  const { items } = useBoard()
  const save = async (name: string) => {
    setEditing(false)
    if (name.trim() && name !== list.name) await db.lists.update(list.id, { name: name.trim() })
  }
  return (
    <header className="list-header">
      {editing ? (
        <input
          autoFocus
          defaultValue={list.name}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save(e.currentTarget.value)
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <h3 onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          {list.name}
        </h3>
      )}
      <button
        className="icon-btn subtle"
        aria-label={`Delete list ${list.name}`}
        onClick={() => {
          const n = items(listContainer(list.id)).length
          if (!n || confirm(`Delete "${list.name}" and its ${n} task(s)?`)) void deleteList(list.id)
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </header>
  )
}

export function SomedayPanel({ lists }: { lists: SomedayList[] }) {
  const { calendarId } = useBoard()
  return (
    <div className="someday">
      {lists.map((list) => (
        <Column key={list.id} container={listContainer(list.id)} className="list" header={<ListHeader list={list} />} />
      ))}
      <button className="add-list" onClick={() => addList(calendarId)}>
        <Icon name="plus" size={16} /> New list
      </button>
    </div>
  )
}
