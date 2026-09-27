import type { Task } from '../types'

/**
 * Server-less sharing: a task (or a set of tasks) is encoded into the URL
 * fragment, so the data never reaches any server. The receiver can import it.
 */
export interface SharedTask {
  title: string
  note: string
  date: string | null
  color: Task['color']
  subtasks: { title: string; done: boolean }[]
  rrule: string | null
}

export interface SharePayload {
  v: 1
  title: string
  tasks: SharedTask[]
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export const toShared = (t: Task): SharedTask => ({
  title: t.title,
  note: t.note,
  date: t.date,
  color: t.color,
  subtasks: t.subtasks.map(({ title, done }) => ({ title, done })),
  rrule: t.rrule,
})

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

export async function decodeShare(code: string): Promise<SharePayload> {
  const json = await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw'))
  const data = JSON.parse(new TextDecoder().decode(json)) as SharePayload
  if (data.v !== 1 || !Array.isArray(data.tasks)) throw new Error('Unsupported share link')
  return data
}

/** Where the web version is hosted; share links point there. Empty = current page. */
const PUBLIC_URL: string = import.meta.env.VITE_PUBLIC_URL ?? ''

/** Null when there is no web address to link to (Android app without VITE_PUBLIC_URL). */
export async function shareUrl(payload: SharePayload, native = false): Promise<string | null> {
  const base = PUBLIC_URL || (native ? '' : `${location.origin}${location.pathname}`)
  return base ? `${base}#share=${await encodeShare(payload)}` : null
}

export function shareSummary(t: SharedTask): string {
  return [
    t.title,
    t.date ?? '',
    t.note,
    ...t.subtasks.map((s) => `${s.done ? '☑' : '☐'} ${s.title}`),
  ]
    .filter(Boolean)
    .join('\n')
}
