import type { JournalTarget } from './components/JournalPage'
import { createContext, useContext } from 'react'
import type { ContainerId, FeedEvent, Item, Settings } from './types'

export interface BoardState {
  settings: Settings
  calendarId: string
  today: string
  overContainer: ContainerId | null
  items: (c: ContainerId) => Item[]
  events: (date: string) => (FeedEvent & { color: string; feedId: string })[]
  openItem: (item: Item) => void
  selectedDate: string
  openJournal: (date: string, target?: JournalTarget) => void
  goToDate: (date: string, view?: Settings['view']) => void
}

export const BoardContext = createContext<BoardState | null>(null)

export function useBoard() {
  const ctx = useContext(BoardContext)
  if (!ctx) throw new Error('useBoard outside BoardContext')
  return ctx
}
