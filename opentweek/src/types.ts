export type ColorKey =
  | 'none'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray'

export const COLORS: ColorKey[] = [
  'none',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'gray',
]

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
}

export interface Task {
  id: string
  calendarId: string
  title: string
  done: boolean
  /** Day the task lives on (yyyy-MM-dd). Null when the task is in a Someday list. */
  date: string | null
  /** Someday list the task lives in. Null when the task is on a day. */
  listId: string | null
  order: number
  color: ColorKey
  note: string
  subtasks: Subtask[]
  attachments: Attachment[]
  /** RRULE body without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=MO". DTSTART is `date`. */
  rrule: string | null
  /** Occurrence dates removed from the series. */
  exdates: string[]
  /** Occurrence dates marked done. */
  doneDates: string[]
  /** Reminder time (HH:mm) on the task's day / each occurrence. */
  reminder: string | null
  createdAt: number
  updatedAt: number
}

export interface SomedayList {
  id: string
  calendarId: string
  name: string
  order: number
}

export interface Calendar {
  id: string
  name: string
  color: ColorKey
  order: number
}

export interface FeedEvent {
  uid: string
  title: string
  date: string
  time: string | null
  endTime: string | null
  location: string | null
}

/** A read-only ICS subscription (Google / Apple / Outlook "secret address"). */
export interface Feed {
  id: string
  name: string
  url: string
  color: ColorKey
  enabled: boolean
  events: FeedEvent[]
  fetchedAt: number | null
  error: string | null
}

export type WeekendLayout = 'compact' | 'full' | 'hidden'
export type Theme = 'system' | 'light' | 'dark'
export type Paper = 'lined' | 'plain' | 'dotted'
export type View = 'week' | 'month'

export interface Settings {
  activeCalendarId: string
  weekStartsOn: 0 | 1 | 6
  weekendLayout: WeekendLayout
  theme: Theme
  accent: ColorKey
  paper: Paper
  hideCompleted: boolean
  autoRollover: boolean
  showWeekNumbers: boolean
  showSomeday: boolean
  fontScale: number
  notifications: boolean
  corsProxy: string
  view: View
}

/** One visible row: either a plain task or one occurrence of a repeating task. */
export interface Item {
  key: string
  task: Task
  /** Day this row is shown on (occurrence date for repeating tasks). */
  date: string | null
  occurrence: boolean
  done: boolean
}

export type ContainerId = `day:${string}` | `list:${string}`
