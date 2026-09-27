import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, getSettings } from '../db'
import type { Calendar, Feed, Settings, SomedayList, Task } from '../types'

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), [], undefined)
}

export function useCalendars(): Calendar[] {
  return useLiveQuery(() => db.calendars.orderBy('order').toArray(), [], [])
}

export function useTasks(calendarId: string): Task[] | undefined {
  return useLiveQuery(() => db.tasks.where('calendarId').equals(calendarId).toArray(), [calendarId])
}

export function useLists(calendarId: string): SomedayList[] {
  return useLiveQuery(
    async () => (await db.lists.where('calendarId').equals(calendarId).toArray()).sort((a, b) => a.order - b.order),
    [calendarId],
    [],
  )
}

export function useFeeds(): Feed[] {
  return useLiveQuery(() => db.feeds.toArray(), [], [])
}

export { DEFAULT_SETTINGS }
