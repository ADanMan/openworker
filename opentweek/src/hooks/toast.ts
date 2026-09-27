import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let seq = 0

export function toast(message: string, action?: Toast['action'], ttl = 5000) {
  const id = ++seq
  toasts = [...toasts, { id, message, action }]
  emit()
  setTimeout(() => dismiss(id), ttl)
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
  )
}
