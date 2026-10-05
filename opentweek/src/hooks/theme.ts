import { useEffect } from 'react'
import type { Settings } from '../types'

/** The app and its diary popup share the user's existing local appearance preferences. */
export function useTheme(settings: Settings | undefined) {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme === 'system' ? '' : settings.theme
    root.dataset.accent = settings.accent
    root.dataset.paper = settings.paper
    root.style.setProperty('--scale', String(settings.fontScale))
  }, [settings])
}
