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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addQuickTask, containerOf, dayContainer, moveItem } from './actions'
import { BoardContext, type BoardState } from './board'
import { ensureSeed, updateSettings } from './db'
import { useFeedSync, useReminders, useRollover, useToday } from './hooks/background'
import { useCalendars, useFeeds, useLists, useSettings, useTasks } from './hooks/data'
import { fromISODate, isoAddDays, monthGrid, shift, toISODate, weekDays, weekNumber } from './lib/dates'
import { expand } from './lib/recurrence'
import { decodeShare, type SharePayload } from './lib/share'
import { Icon } from './components/Icon'
import { MonthView } from './components/MonthView'
import { SearchDialog } from './components/SearchDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ShareImportDialog } from './components/ShareImportDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { SomedayPanel } from './components/SomedayPanel'
import { JournalPage, type JournalTarget } from './components/JournalPage'
import { BackgroundVoiceMode } from './components/BackgroundVoiceMode'
import { TaskVoiceDialog } from './components/TaskVoiceDialog'
import { j } from './lib/journalCopy'
import { localVoiceBridge } from './lib/localVoice'
import { TaskModal } from './components/TaskModal'
import { TaskRowGhost } from './components/TaskRow'
import { Toasts } from './components/Toasts'
import { WeekView } from './components/WeekView'
import type { ContainerId, FeedEvent, Item, Settings, Task } from './types'
import { focusAddLine } from './ui'
import { fmt, fmtWeekday, resolveLocale, setLocale, t } from './i18n'
import { installBackButton, onExternalIntent, type ExternalIntent } from './native'
import { parseQuickAdd } from './lib/quickadd'
import { describe as describeRule } from './lib/recurrence'
import { toast } from './hooks/toast'

type Panel = 'settings' | 'search' | 'shortcuts' | 'voice' | null

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
  // Locale is module state read by t(); set it before any child renders.
  if (settings) setLocale(resolveLocale(settings.language))
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
  const [mode, setMode] = useState<'calendar' | 'journal'>('calendar')
  const [journalTarget, setJournalTarget] = useState<JournalTarget | undefined>()
  const selectedDate = toISODate(anchor)
  const changeDate = (date: string) => { setJournalTarget(undefined); setAnchor(fromISODate(date)) }
  const openJournal = (date: string, target?: JournalTarget) => { setOpenKey(null); setJournalTarget(target); setAnchor(fromISODate(date)); setMode('journal') }
  const [panel, setPanel] = useState<Panel>(null)
  const [openKey, setOpenKey] = useState<{ id: string; date: string | null } | null>(null)
  const [dragging, setDragging] = useState<Item | null>(null)
  const [overContainer, setOverContainer] = useState<ContainerId | null>(null)
  const [shared, setShared] = useState<SharePayload | null>(null)
  const view = settings.view

  const remindHintShown = useRef(false)
  // Quick add from a spoken or shared phrase: "завтра в 9 позвонить маме".
  const quickAdd = async (text: string) => {
    if (!text.trim()) return
    const parsed = parseQuickAdd(text)
    const task = await addQuickTask(calendarId, parsed)
    setAnchor(fromISODate(parsed.date))
    const when = [
      `${fmtWeekday(fromISODate(parsed.date))} ${fmt(fromISODate(parsed.date), 'd MMM')}`,
      parsed.reminder,
      parsed.rrule ? describeRule({ date: parsed.date, rrule: parsed.rrule }) : null,
    ]
      .filter(Boolean)
      .join(', ')
    toast(t('quickAdded', { title: parsed.title, when }), {
      label: t('open'),
      run: () => setOpenKey({ id: task.id, date: null }),
    })
    if (parsed.reminder && !settings.notifications && !remindHintShown.current) {
      remindHintShown.current = true
      toast(t('enableReminders'))
    }
  }

  const canVoice = !!localVoiceBridge()
  const startVoice = () => {
    if (mode === 'journal' || document.querySelector('dialog[open]')) { toast(j('closeDialog')); return }
    setPanel('voice')
  }

  // Keep the latest handlers for listeners registered once.
  const intentRef = useRef<(i: ExternalIntent) => void>(() => {})
  useEffect(() => {
    intentRef.current = (i) => {
      if (i.kind === 'task') { setMode('calendar'); setOpenKey({ id: i.taskId, date: i.date }) }
      else if (i.kind === 'voice') void startVoice()
      else if (i.kind === 'wakeRecovery') {
        if (document.querySelector('dialog[open]')) toast('Диктовка сохранена. Закройте редактор и откройте дневник для проверки.')
        else setMode('journal')
      }
      else if (i.kind === 'new') {
        setAnchor(new Date())
        focusAddLine(dayContainer(today))
      } else if (i.kind === 'text') void quickAdd(i.text)
    }
  })
  useEffect(() => {
    installBackButton()
    return onExternalIntent((i) => intentRef.current(i))
  }, [])

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
    const map = new Map<string, (FeedEvent & { color: string; feedId: string })[]>()
    for (const feed of feeds) {
      if (!feed.enabled) continue
      for (const ev of feed.events) {
        if (ev.date < from || ev.date > to) continue
        map.set(ev.date, [...(map.get(ev.date) ?? []), { ...ev, color: feed.color, feedId: feed.id }])
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
    openJournal,
    selectedDate,
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
      if (mode === 'journal') return
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
        v: () => intentRef.current({ kind: 'voice' }),
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
  }, [view, today, mode, settings.hideCompleted, settings.showSomeday])

  // Touch: horizontal swipe on the board changes week/month (ignored while dragging a task).
  const boardRef = useRef<HTMLElement>(null)
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0]
    touch.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, t: Date.now() } : null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start || dragging) return
    const p = e.changedTouches[0]
    const dx = p.clientX - start.x
    const dy = p.clientY - start.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - start.t < 600) {
      setAnchor((a) => shift(a, view, dx < 0 ? 1 : -1))
    }
  }

  // Phones show days stacked vertically: bring today into view when the week opens.
  const weekStart = days[0]
  useEffect(() => {
    if (view !== 'week' || !window.matchMedia('(max-width: 820px)').matches) return
    // Scroll only the board: scrollIntoView would also move the page and the header.
    const board = boardRef.current
    const el = board?.querySelector('.day.is-today')
    if (board && el) board.scrollTop += el.getBoundingClientRect().top - board.getBoundingClientRect().top
  }, [view, weekStart])

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
      ? fmt(fromISODate(days[0]), 'LLLL yyyy') !== fmt(fromISODate(days[6]), 'LLLL yyyy')
        ? `${fmt(fromISODate(days[0]), 'LLL')} – ${fmt(fromISODate(days[6]), 'LLL yyyy')}`
        : fmt(fromISODate(days[0]), 'LLLL yyyy')
      : fmt(anchor, 'LLLL yyyy')

  return (
    <BoardContext.Provider value={board}>
      <div className={`app view-${view}`}>
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden="true" />
            <select
              className="calendar-select"
              value={calendarId}
              aria-label={t('calendar')}
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
            <h1>{mode === 'journal' ? fmt(anchor, 'd MMMM yyyy') : title}</h1>
            {mode === 'calendar' && view === 'week' && settings.showWeekNumbers && <span className="week-badge">W{weekNumber(days[3])}</span>}
          </div>
          <nav className="nav">
            <button className="icon-btn" aria-label={t('previous')} onClick={() => changeDate(mode === 'journal' ? isoAddDays(selectedDate, -1) : toISODate(shift(anchor, view, -1)))}>
              <Icon name="left" />
            </button>
            <button className="btn today-btn" onClick={() => changeDate(toISODate(new Date()))}>
              {t('today')}
            </button>
            <button className="icon-btn" aria-label={t('next')} onClick={() => changeDate(mode === 'journal' ? isoAddDays(selectedDate, 1) : toISODate(shift(anchor, view, 1)))}>
              <Icon name="right" />
            </button>
            <div className="segmented" role="tablist" hidden={mode === 'journal'}>
              {(['week', 'month'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => updateSettings({ view: v })}>
                  {v === 'week' ? t('week') : t('month')}
                </button>
              ))}
            </div>
          </nav>
          <div className="tools">
            {canVoice && mode === 'calendar' && (
              <button className="icon-btn" aria-label={t('voiceTask')} title={`${t('voiceTask')} (V)`} onClick={startVoice}>
                <Icon name="mic" />
              </button>
            )}
            <button className="icon-btn" aria-label={t('search')} title={`${t('search')} (/)`} onClick={() => setPanel('search')}>
              <Icon name="search" />
            </button>
            <button
              className={`icon-btn${settings.hideCompleted ? ' active' : ''}`}
              aria-label={settings.hideCompleted ? t('showCompleted') : t('hideCompleted')}
              title={`${t('hideCompleted')} (H)`}
              onClick={() => updateSettings({ hideCompleted: !settings.hideCompleted })}
            >
              <Icon name={settings.hideCompleted ? 'eyeOff' : 'eye'} />
            </button>
            <button className="icon-btn hide-mobile" aria-label={t('print')} title={`${t('print')} (P)`} onClick={() => window.print()}>
              <Icon name="print" />
            </button>
            <button className="icon-btn hide-mobile" aria-label={t('shortcuts')} title={`${t('shortcuts')} (?)`} onClick={() => setPanel('shortcuts')}>
              <Icon name="keyboard" />
            </button>
            <button className="icon-btn" aria-label={t('settings')} title={`${t('settings')} (,)`} onClick={() => setPanel('settings')}>
              <Icon name="settings" />
            </button>
          </div>
        </header>

        <div className="mode-bar" aria-label="Режим приложения">
          <button className={`btn${mode === 'calendar' ? ' primary' : ''}`} aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}>Календарь</button>
          <button className={`btn${mode === 'journal' ? ' primary' : ''}`} aria-label="Дневник чувств" aria-pressed={mode === 'journal'} onClick={() => setMode('journal')}>Дневник</button>
          <label>Дата <input type="date" aria-label="Общая дата" value={selectedDate} onChange={(e) => e.target.value && changeDate(e.target.value)} /></label>
        </div>
        <BackgroundVoiceMode />
        {mode === 'journal' ? <JournalPage key={`${selectedDate}:${JSON.stringify(journalTarget)}`} date={selectedDate} calendarId={calendarId} target={journalTarget} onDate={changeDate}
          onOpenTask={async (task, date) => { await updateSettings({ activeCalendarId: task.calendarId }); setAnchor(fromISODate(date ?? task.date ?? selectedDate)); setMode('calendar'); setOpenKey({ id: task.id, date }) }}
          onOpenFeed={(date) => { changeDate(date); setMode('calendar') }} /> : <DndContext
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
          <main className="board" ref={boardRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {view === 'week' ? <WeekView days={days} /> : <MonthView weeks={grid} month={anchor.getMonth()} />}
          </main>
          <section className={`someday-wrap${settings.showSomeday ? '' : ' collapsed'}`}>
            <button className="someday-toggle" onClick={() => updateSettings({ showSomeday: !settings.showSomeday })}>
              <Icon name="chevronDown" size={14} /> {t('someday')}
            </button>
            {settings.showSomeday && <SomedayPanel lists={lists} />}
          </section>
          <DragOverlay dropAnimation={null}>{dragging && <TaskRowGhost item={dragging} />}</DragOverlay>
        </DndContext>}

        {openItem && <TaskModal item={openItem} lists={lists} onClose={() => setOpenKey(null)} onOpenJournal={() => openJournal(openItem.date ?? selectedDate, { taskId: openItem.task.id, occurrenceDate: openItem.occurrence ? openItem.date : null })} />}
        {panel === 'voice' && <TaskVoiceDialog onClose={() => setPanel(null)} onSubmit={quickAdd} />}
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
