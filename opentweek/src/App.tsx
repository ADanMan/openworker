import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { containerOf, dayContainer, moveItem } from './actions'
import { BoardContext, type BoardState } from './board'
import { ensureSeed, updateSettings } from './db'
import { useFeedSync, useReminders, useRollover, useToday } from './hooks/background'
import { useCalendars, useFeeds, useLists, useSettings, useTasks } from './hooks/data'
import { fromISODate, monthGrid, shift, weekDays, weekNumber } from './lib/dates'
import { expand } from './lib/recurrence'
import { decodeShare, type SharePayload } from './lib/share'
import { Icon } from './components/Icon'
import { MonthView } from './components/MonthView'
import { SearchDialog } from './components/SearchDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ShareImportDialog } from './components/ShareImportDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { SomedayPanel } from './components/SomedayPanel'
import { TaskModal } from './components/TaskModal'
import { TaskRowGhost } from './components/TaskRow'
import { Toasts } from './components/Toasts'
import { WeekView } from './components/WeekView'
import type { ContainerId, FeedEvent, Item, Settings, Task } from './types'
import { focusAddLine } from './ui'

type Panel = 'settings' | 'search' | 'shortcuts' | null

// Prefer the droppable directly under the pointer (works across columns),
// fall back to the closest one for keyboard dragging.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  if (hits.length) {
    const item = hits.find((h) => h.data?.droppableContainer.data.current?.type === 'item')
    return item ? [item] : hits
  }
  return closestCenter(args)
}

function useTheme(settings: Settings | undefined) {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme === 'system' ? '' : settings.theme
    root.dataset.accent = settings.accent
    root.dataset.paper = settings.paper
    root.style.setProperty('--scale', String(settings.fontScale))
  }, [settings])
}

export default function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    ensureSeed().then(() => setReady(true))
  }, [])
  const settings = useSettings()
  useTheme(settings)
  if (!ready || !settings?.activeCalendarId) return <div className="loading">opentweek</div>
  return <Board settings={settings} />
}

function Board({ settings }: { settings: Settings }) {
  const calendarId = settings.activeCalendarId
  const today = useToday()
  const tasks = useTasks(calendarId)
  const lists = useLists(calendarId)
  const calendars = useCalendars()
  const feeds = useFeeds()
  const [anchor, setAnchor] = useState(() => new Date())
  const [panel, setPanel] = useState<Panel>(null)
  const [openKey, setOpenKey] = useState<{ id: string; date: string | null } | null>(null)
  const [dragging, setDragging] = useState<Item | null>(null)
  const [overContainer, setOverContainer] = useState<ContainerId | null>(null)
  const [shared, setShared] = useState<SharePayload | null>(null)
  const view = settings.view

  useRollover(settings, today)
  useReminders(settings, tasks, today)
  useFeedSync(settings)

  // Share links: #share=<payload>
  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#share=(.+)$/)
      if (!m) return
      decodeShare(m[1])
        .then(setShared)
        .catch(() => undefined)
        .finally(() => history.replaceState(null, '', location.pathname + location.search))
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  const days = useMemo(() => weekDays(anchor, settings.weekStartsOn), [anchor, settings.weekStartsOn])
  const grid = useMemo(() => monthGrid(anchor, settings.weekStartsOn), [anchor, settings.weekStartsOn])
  const [from, to] = view === 'week' ? [days[0], days[6]] : [grid[0][0], grid[grid.length - 1][6]]

  const byContainer = useMemo(() => {
    const map = new Map<ContainerId, Item[]>()
    for (const item of expand(tasks ?? [], from, to)) {
      if (settings.hideCompleted && item.done) continue
      const c = containerOf(item)
      map.set(c, [...(map.get(c) ?? []), item])
    }
    return map
  }, [tasks, from, to, settings.hideCompleted])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, (FeedEvent & { color: string })[]>()
    for (const feed of feeds) {
      if (!feed.enabled) continue
      for (const ev of feed.events) {
        if (ev.date < from || ev.date > to) continue
        map.set(ev.date, [...(map.get(ev.date) ?? []), { ...ev, color: feed.color }])
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    return map
  }, [feeds, from, to])

  const goToDate = useCallback((date: string, v?: Settings['view']) => {
    setAnchor(fromISODate(date))
    if (v) void updateSettings({ view: v })
  }, [])

  const board: BoardState = {
    settings,
    calendarId,
    today,
    overContainer,
    items: (c) => byContainer.get(c) ?? [],
    events: (d) => eventsByDate.get(d) ?? [],
    openItem: (item) => setOpenKey({ id: item.task.id, date: item.occurrence ? item.date : null }),
    goToDate,
  }

  const openItem = useMemo((): Item | null => {
    const task = tasks?.find((t) => t.id === openKey?.id)
    if (!task || !openKey) return null
    if (openKey.date && task.rrule) {
      return {
        key: `${task.id}@${openKey.date}`,
        task,
        date: openKey.date,
        occurrence: true,
        done: task.doneDates.includes(openKey.date),
      }
    }
    return { key: task.id, task, date: task.date, occurrence: false, done: task.done }
  }, [tasks, openKey])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], dialog') || e.altKey) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        return setPanel('search')
      }
      if (e.metaKey || e.ctrlKey) return
      const actions: Record<string, () => void> = {
        ArrowLeft: () => setAnchor((a) => shift(a, view, -1)),
        ArrowRight: () => setAnchor((a) => shift(a, view, 1)),
        t: () => setAnchor(new Date()),
        w: () => updateSettings({ view: 'week' }),
        m: () => updateSettings({ view: 'month' }),
        n: () => {
          setAnchor(new Date())
          focusAddLine(dayContainer(today))
        },
        '/': () => setPanel('search'),
        h: () => updateSettings({ hideCompleted: !settings.hideCompleted }),
        s: () => updateSettings({ showSomeday: !settings.showSomeday }),
        p: () => window.print(),
        ',': () => setPanel('settings'),
        '?': () => setPanel('shortcuts'),
      }
      const run = actions[e.key] ?? actions[e.key.toLowerCase()]
      // Arrow keys on a focused task belong to keyboard drag & drop.
      if (!run || (e.key.startsWith('Arrow') && target.closest('.row'))) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, today, settings.hideCompleted, settings.showSomeday])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.item as Item) ?? null)
  const onDragOver = (e: DragOverEvent) =>
    setOverContainer((e.over?.data.current?.container as ContainerId | undefined) ?? null)
  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null)
    setOverContainer(null)
    const active = e.active.data.current as { item: Item; container: ContainerId } | undefined
    const over = e.over?.data.current as { type: 'item' | 'container'; item?: Item; container: ContainerId } | undefined
    if (!active || !over) return
    const targetItems = byContainer.get(over.container) ?? []
    const index =
      over.type === 'item' ? targetItems.findIndex((i) => i.key === over.item!.key) : targetItems.length
    if (over.type === 'item' && over.item!.key === active.item.key) return
    await moveItem(active.item, over.container, index < 0 ? targetItems.length : index, targetItems)
  }

  const calendar = calendars.find((c) => c.id === calendarId)
  const title =
    view === 'week'
      ? format(fromISODate(days[0]), 'MMMM yyyy') !== format(fromISODate(days[6]), 'MMMM yyyy')
        ? `${format(fromISODate(days[0]), 'MMM')} – ${format(fromISODate(days[6]), 'MMM yyyy')}`
        : format(fromISODate(days[0]), 'MMMM yyyy')
      : format(anchor, 'MMMM yyyy')

  return (
    <BoardContext.Provider value={board}>
      <div className={`app view-${view}`}>
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden="true" />
            <select
              className="calendar-select"
              value={calendarId}
              aria-label="Calendar"
              onChange={(e) => updateSettings({ activeCalendarId: e.target.value })}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="period">
            <h1>{title}</h1>
            {view === 'week' && settings.showWeekNumbers && <span className="week-badge">W{weekNumber(days[3])}</span>}
          </div>
          <nav className="nav">
            <button className="icon-btn" aria-label="Previous" onClick={() => setAnchor((a) => shift(a, view, -1))}>
              <Icon name="left" />
            </button>
            <button className="btn today-btn" onClick={() => setAnchor(new Date())}>
              Today
            </button>
            <button className="icon-btn" aria-label="Next" onClick={() => setAnchor((a) => shift(a, view, 1))}>
              <Icon name="right" />
            </button>
            <div className="segmented" role="tablist">
              {(['week', 'month'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => updateSettings({ view: v })}>
                  {v === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
            <button className="icon-btn" aria-label="Search" title="Search (/)" onClick={() => setPanel('search')}>
              <Icon name="search" />
            </button>
            <button
              className={`icon-btn optional${settings.hideCompleted ? ' active' : ''}`}
              aria-label={settings.hideCompleted ? 'Show completed' : 'Hide completed'}
              title="Hide completed (H)"
              onClick={() => updateSettings({ hideCompleted: !settings.hideCompleted })}
            >
              <Icon name={settings.hideCompleted ? 'eyeOff' : 'eye'} />
            </button>
            <button className="icon-btn hide-mobile" aria-label="Print" title="Print (P)" onClick={() => window.print()}>
              <Icon name="print" />
            </button>
            <button className="icon-btn hide-mobile" aria-label="Shortcuts" title="Shortcuts (?)" onClick={() => setPanel('shortcuts')}>
              <Icon name="keyboard" />
            </button>
            <button className="icon-btn" aria-label="Settings" title="Settings (,)" onClick={() => setPanel('settings')}>
              <Icon name="settings" />
            </button>
          </nav>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragging(null)
            setOverContainer(null)
          }}
        >
          <main className="board">
            {view === 'week' ? <WeekView days={days} /> : <MonthView weeks={grid} month={anchor.getMonth()} />}
          </main>
          <section className={`someday-wrap${settings.showSomeday ? '' : ' collapsed'}`}>
            <button className="someday-toggle" onClick={() => updateSettings({ showSomeday: !settings.showSomeday })}>
              <Icon name="chevronDown" size={14} /> Someday
            </button>
            {settings.showSomeday && <SomedayPanel lists={lists} />}
          </section>
          <DragOverlay dropAnimation={null}>{dragging && <TaskRowGhost item={dragging} />}</DragOverlay>
        </DndContext>

        {openItem && <TaskModal item={openItem} lists={lists} onClose={() => setOpenKey(null)} />}
        {panel === 'settings' && <SettingsDialog settings={settings} onClose={() => setPanel(null)} />}
        {panel === 'shortcuts' && <ShortcutsDialog onClose={() => setPanel(null)} />}
        {panel === 'search' && (
          <SearchDialog
            tasks={tasks ?? []}
            lists={lists}
            onClose={() => setPanel(null)}
            onPick={(t: Task) => {
              setPanel(null)
              if (t.date) setAnchor(fromISODate(t.date))
              setOpenKey({ id: t.id, date: null })
            }}
          />
        )}
        {shared && <ShareImportDialog payload={shared} calendarId={calendarId} onClose={() => setShared(null)} />}
        <Toasts />
        <footer className="print-footer">{calendar?.name} · opentweek</footer>
      </div>
    </BoardContext.Provider>
  )
}

