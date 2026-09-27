import { beforeEach, describe, expect, it } from 'vitest'
import { addTask, dayContainer, listContainer, moveItem, rollover, toggleDone } from '../actions'
import { db } from '../db'
import { expand, presetRule } from '../lib/recurrence'

const week = ['2026-09-21', '2026-09-27'] as const
const rows = async (container: string) =>
  expand(await db.tasks.toArray(), ...week).filter((i) =>
    container.startsWith('day:') ? i.date === container.slice(4) : i.task.listId === container.slice(5),
  )

beforeEach(async () => {
  await db.tasks.clear()
})

describe('actions', () => {
  it('reorders within a day and moves across days and lists', async () => {
    const mon = dayContainer('2026-09-21')
    await addTask('c', mon, 'a')
    await addTask('c', mon, 'b')
    await addTask('c', mon, 'c')
    let monRows = await rows(mon)
    await moveItem(monRows[2], mon, 0, monRows)
    expect((await rows(mon)).map((i) => i.task.title)).toEqual(['c', 'a', 'b'])

    monRows = await rows(mon)
    const tue = dayContainer('2026-09-22')
    await moveItem(monRows[0], tue, 0, await rows(tue))
    expect((await rows(tue)).map((i) => i.task.title)).toEqual(['c'])

    const list = listContainer('someday')
    await moveItem((await rows(mon))[0], list, 0, [])
    const moved = (await db.tasks.toArray()).find((t) => t.title === 'a')!
    expect(moved).toMatchObject({ date: null, listId: 'someday' })
  })

  it('detaches a repeating occurrence when dragged to another day', async () => {
    const mon = dayContainer('2026-09-21')
    const t = await addTask('c', mon, 'gym')
    await db.tasks.update(t.id, { rrule: presetRule('daily', '2026-09-21') })
    const occ = (await rows(dayContainer('2026-09-23')))[0]
    expect(occ.occurrence).toBe(true)
    await moveItem(occ, dayContainer('2026-09-24'), 0, await rows(dayContainer('2026-09-24')))
    const thu = await rows(dayContainer('2026-09-24'))
    expect(thu.map((i) => i.occurrence).sort()).toEqual([false, true])
    expect(await rows(dayContainer('2026-09-23'))).toEqual([])
  })

  it('tracks done per occurrence', async () => {
    const t = await addTask('c', dayContainer('2026-09-21'), 'water plants')
    await db.tasks.update(t.id, { rrule: presetRule('daily', '2026-09-21') })
    await toggleDone((await rows(dayContainer('2026-09-22')))[0])
    const all = expand(await db.tasks.toArray(), ...week)
    expect(all.filter((i) => i.done).map((i) => i.date)).toEqual(['2026-09-22'])
  })

  it('rolls unfinished past tasks over to today', async () => {
    await addTask('c', dayContainer('2026-09-20'), 'late')
    const done = await addTask('c', dayContainer('2026-09-20'), 'finished')
    await db.tasks.update(done.id, { done: true })
    expect(await rollover('c', '2026-09-27')).toBe(1)
    expect((await db.tasks.toArray()).find((t) => t.title === 'late')!.date).toBe('2026-09-27')
  })
})
