import { describe, expect, it } from 'vitest'
import { decodeShare, encodeShare } from '../lib/share'

describe('share links', () => {
  it('round-trips a payload through the URL-safe code', async () => {
    const payload = {
      v: 1 as const,
      title: 'Trip',
      tasks: [{ title: 'Pack 🎒', note: 'passport', date: '2026-10-01', color: 'blue' as const, subtasks: [{ title: 'socks', done: false }], rrule: null }],
    }
    const code = await encodeShare(payload)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await decodeShare(code)).toEqual(payload)
  })
})
