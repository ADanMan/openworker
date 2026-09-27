import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { rollover } from '../actions'
import { db } from '../db'
import { isoAddDays, todayISO } from '../lib/dates'
import { parseEvents } from '../lib/ics'
import { expand } from '../lib/recurrence'
import { fetchText, isNative, syncNativeReminders } from '../native'
import type { Feed, Settings, Task } from '../types'
import { toast } from './toast'

/** Current date that re-renders when the day changes (app left open overnight). */
export function useToday() {
  const [today, setToday] = useState(todayISO)
  useEffect(() => {
    const id = setInterval(() => setToday((prev) => (prev === todayISO() ? prev : todayISO())), 30_000)
    return () => clearInterval(id)
  }, [])
  return today
}

export function useRollover(settings: Settings | undefined, today: string) {
  useEffect(() => {
    if (!settings?.autoRollover || !settings.activeCalendarId) return
    rollover(settings.activeCalendarId, today).then((n) => {
      if (n) toast(t('movedToToday', { n }))
    })
  }, [settings?.autoRollover, settings?.activeCalendarId, today])
}

const FIRED_KEY = 'opentweek:fired-reminders'
const loadFired = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

async function notify(title: string, body: string) {
  const reg = await navigator.serviceWorker?.getRegistration?.()
  if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', tag: body })
  else new Notification(title, { body })
}

/** Local reminders: fire a notification when a task's reminder time is reached (app must be open). */
export function useReminders(settings: Settings | undefined, tasks: Task[] | undefined, today: string) {
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])
  // Android: the OS fires scheduled reminders, even when the app is closed.
  const enabled = !!settings?.notifications
  useEffect(() => {
    if (!isNative || !tasks) return
    const id = setTimeout(() => syncNativeReminders(enabled ? tasks : []), 800)
    return () => clearTimeout(id)
  }, [enabled, tasks, today])

  useEffect(() => {
    if (isNative || !settings?.notifications || typeof Notification === 'undefined') return
    const check = () => {
      if (Notification.permission !== 'granted' || !tasksRef.current) return
      const fired = loadFired()
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      for (const item of expand(tasksRef.current, today, today)) {
        const { task } = item
        if (!task.reminder || item.done || item.date !== today || task.reminder > hhmm) continue
        const key = `${item.key}|${today}|${task.reminder}`
        if (fired.has(key)) continue
        fired.add(key)
        void notify(task.title || 'Reminder', `${task.reminder} · opentweek`)
      }
      localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-500)))
    }
    check()
    const id = setInterval(check, 20_000)
    return () => clearInterval(id)
  }, [settings?.notifications, today])
}

export async function refreshFeed(feed: Feed, corsProxy: string) {
  const url = feed.url.replace(/^webcal:/i, 'https:')
  // The Android app fetches natively (no CORS), so the proxy is only for the browser.
  const target = corsProxy && !isNative ? corsProxy.replace('{url}', encodeURIComponent(url)) : url
  try {
    const text = await fetchText(target)
    const today = todayISO()
    const events = parseEvents(text, isoAddDays(today, -120), isoAddDays(today, 400))
    await db.feeds.update(feed.id, { events, fetchedAt: Date.now(), error: null })
  } catch (e) {
    const message = e instanceof TypeError ? t('corsError') : String(e)
    await db.feeds.update(feed.id, { error: message, fetchedAt: Date.now() })
  }
}

/** Refresh subscribed calendars on load and every 30 minutes. */
export function useFeedSync(settings: Settings | undefined) {
  const proxy = settings?.corsProxy ?? ''
  const loaded = settings !== undefined
  useEffect(() => {
    if (!loaded) return
    const run = async () => {
      const feeds = await db.feeds.toArray()
      await Promise.all(feeds.filter((f) => f.enabled).map((f) => refreshFeed(f, proxy)))
    }
    void run()
    const id = setInterval(run, 30 * 60_000)
    return () => clearInterval(id)
  }, [loaded, proxy])
}
