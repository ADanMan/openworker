import { isoAddDays, toISODate } from './lib/dates'
import { expand } from './lib/recurrence'
import type { Task } from './types'

/** `window.OpenTweekNative`, injected by the Android shell (android/src/app/opentweek/NativeBridge.java). */
interface NativeBridge {
  platform(): string
  notificationsAllowed(): boolean
  requestNotifications(): void
  setReminders(json: string): void
  share(title: string, text: string): void
  saveFile(name: string, mime: string, base64: string): void
  takeIntent(): string
  voiceAvailable(): boolean
  startVoice(lang: string, prompt: string): void
  minimize(): void
  fetchText(id: number, url: string): void
}

declare global {
  interface Window {
    OpenTweekNative?: NativeBridge
    __otBack?: () => boolean
    __otNotifResult?: (granted: boolean) => void
    __otFetch?: (id: number, ok: boolean, text: string) => void
    __otVoice?: (ok: boolean, text: string) => void
  }
}

const bridge = typeof window !== 'undefined' ? window.OpenTweekNative : undefined

/** True inside the Android app, false in the browser/PWA. */
export const isNative = !!bridge

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** Save a file: a download in the browser, the system "Save as" picker on Android. */
export async function saveFile(filename: string, content: string | Blob, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  if (bridge) {
    bridge.saveFile(filename, type || blob.type, await blobToBase64(blob))
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Share text: system share sheet on Android, clipboard in the browser. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied'> {
  if (bridge) {
    bridge.share(title, text)
    return 'shared'
  }
  await navigator.clipboard?.writeText(text)
  return 'copied'
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (bridge) {
    if (bridge.notificationsAllowed()) return true
    return new Promise((resolve) => {
      window.__otNotifResult = (granted) => {
        window.__otNotifResult = undefined
        resolve(granted)
      }
      bridge.requestNotifications()
    })
  }
  if (typeof Notification === 'undefined') return false
  return Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'
}

// Alarm ids must be 32-bit ints; derive a stable one from the occurrence key.
export const hashId = (s: string) => {
  let h = 0
  for (const ch of s) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0
  return Math.abs(h) || 1
}

const MAX_SCHEDULED = 100
const HORIZON_DAYS = 30

export interface ScheduledReminder {
  id: number
  at: number
  title: string
  body: string
  taskId: string
  date: string
}

/** Upcoming reminders (next 30 days, at most 100) in the shape the Android shell schedules. */
export function upcomingReminders(tasks: Task[], now = new Date()): ScheduledReminder[] {
  const today = toISODate(now)
  return expand(tasks, today, isoAddDays(today, HORIZON_DAYS))
    .filter((i) => i.task.reminder && i.date && !i.done)
    .map((i) => {
      const [h, m] = i.task.reminder!.split(':').map(Number)
      const [y, mo, d] = i.date!.split('-').map(Number)
      return {
        id: hashId(i.key),
        at: new Date(y, mo - 1, d, h, m).getTime(),
        title: i.task.title || 'Reminder',
        body: i.task.reminder!,
        taskId: i.task.id,
        date: i.occurrence ? i.date! : '',
      }
    })
    .filter((r) => r.at > now.getTime())
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED)
}

/** Android: hand the reminder schedule to the OS so it fires while the app is closed. */
export function syncNativeReminders(tasks: Task[]) {
  bridge?.setReminders(JSON.stringify(upcomingReminders(tasks)))
}

/** Android back button: close the top dialog if any; the shell leaves the app otherwise. */
export function installBackButton() {
  if (!bridge) return
  window.__otBack = () => {
    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
    const top = dialogs[dialogs.length - 1]
    if (!top) return false
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close()
    return true
  }
}

/** What opened (or re-focused) the app from outside. */
export type ExternalIntent =
  | { kind: 'task'; taskId: string; date: string | null } // tap on a reminder
  | { kind: 'voice' } // launcher shortcut "Voice task"
  | { kind: 'new' } // launcher shortcut "New task"
  | { kind: 'text'; text: string } // text shared from another app

/** Delivers external intents: once for the launch intent, then for every new one. */
export function onExternalIntent(handle: (intent: ExternalIntent) => void) {
  if (bridge) {
    // Methods added after 1.0 are checked before use (see docs/20-architecture.md, section 6).
    if (typeof bridge.takeIntent !== 'function') return () => {}
    const take = () => {
      const raw = bridge.takeIntent()
      if (!raw) return
      try {
        const i = JSON.parse(raw) as ExternalIntent & { date?: string }
        handle(i.kind === 'task' ? { ...i, date: i.date || null } : i)
      } catch {
        /* malformed intent from the shell: ignore */
      }
    }
    take()
    window.addEventListener('ot-intent', take)
    return () => window.removeEventListener('ot-intent', take)
  }
  // PWA share target (manifest share_target, GET): ?title=&text=&url=
  const q = new URLSearchParams(location.search)
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join(' ').trim()
  if (shared) {
    history.replaceState(null, '', location.pathname + location.hash)
    handle({ kind: 'text', text: shared })
  }
  return () => {}
}

const pendingFetches = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()
let fetchSeq = 0

/** GET text. On Android it goes through the native side, which is not subject to CORS. */
export function fetchText(url: string): Promise<string> {
  if (!bridge) {
    return fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
  }
  window.__otFetch ??= (id, ok, text) => {
    const p = pendingFetches.get(id)
    pendingFetches.delete(id)
    if (ok) p?.resolve(text)
    else p?.reject(new Error(text))
  }
  const id = ++fetchSeq
  return new Promise((resolve, reject) => {
    pendingFetches.set(id, { resolve, reject })
    bridge.fetchText(id, url)
  })
}
