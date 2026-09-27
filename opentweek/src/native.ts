import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Share } from '@capacitor/share'
import { isoAddDays, todayISO } from './lib/dates'
import { expand } from './lib/recurrence'
import type { Task } from './types'

/** True inside the Android (Capacitor) app, false in the browser/PWA. */
export const isNative = Capacitor.isNativePlatform()

/** Save a text file: a download in the browser, the system share sheet on Android. */
const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export async function saveFile(filename: string, content: string | Blob, type: string) {
  if (!isNative) {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
  const { uri } = await Filesystem.writeFile(
    content instanceof Blob
      ? { path: filename, data: await blobToBase64(content), directory: Directory.Cache }
      : { path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 },
  )
  await Share.share({ title: filename, files: [uri] })
}

/** Share text/URL: system share sheet on Android, clipboard in the browser. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied'> {
  if (isNative) {
    await Share.share({ title, text })
    return 'shared'
  }
  await navigator.clipboard?.writeText(text)
  return 'copied'
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) {
    if (typeof Notification === 'undefined') return false
    return Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'
  }
  const { display } = await LocalNotifications.requestPermissions()
  return display === 'granted'
}

// Notification ids must be 32-bit ints; derive a stable one from the occurrence key.
const hashId = (s: string) => {
  let h = 0
  for (const ch of s) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0
  return Math.abs(h) || 1
}

const MAX_SCHEDULED = 60
const HORIZON_DAYS = 21

/**
 * Android: hand upcoming reminders to the OS so they fire even when the app is
 * closed. Re-run whenever tasks change; it replaces the previous schedule.
 */
export async function syncNativeReminders(tasks: Task[]) {
  if (!isNative) return
  const today = todayISO()
  const now = Date.now()
  const upcoming = expand(tasks, today, isoAddDays(today, HORIZON_DAYS))
    .filter((i) => i.task.reminder && i.date && !i.done)
    .map((i) => {
      const [h, m] = i.task.reminder!.split(':').map(Number)
      const [y, mo, d] = i.date!.split('-').map(Number)
      return { item: i, at: new Date(y, mo - 1, d, h, m) }
    })
    .filter((r) => r.at.getTime() > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED)

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications })
  if (!upcoming.length) return
  await LocalNotifications.schedule({
    notifications: upcoming.map(({ item, at }) => ({
      id: hashId(item.key),
      title: item.task.title || 'Reminder',
      body: `${item.task.reminder} · opentweek`,
      schedule: { at, allowWhileIdle: true },
      extra: { taskId: item.task.id, date: item.occurrence ? item.date : null },
    })),
  })
}

/** Android back button: close the top dialog if any, otherwise leave the app. */
export function installBackButton() {
  if (!isNative) return
  void App.addListener('backButton', () => {
    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
    const top = dialogs[dialogs.length - 1]
    if (top) top.close()
    else void App.minimizeApp()
  })
}

/** Tapping a reminder opens its task. */
export function onReminderTap(open: (taskId: string, date: string | null) => void) {
  if (!isNative) return () => {}
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const extra = e.notification.extra as { taskId?: string; date?: string | null } | undefined
    if (extra?.taskId) open(extra.taskId, extra.date ?? null)
  })
  return () => void handle.then((h) => h.remove())
}
