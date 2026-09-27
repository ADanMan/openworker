import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../lib/quickadd'
import { presetRule } from '../lib/recurrence'

// Sunday 27 September 2026, 10:15
const now = new Date(2026, 8, 27, 10, 15)
const p = (s: string) => parseQuickAdd(s, now)

describe('quick add, Russian', () => {
  it('parses day and time', () => {
    expect(p('завтра в 9 утра позвонить маме')).toEqual({
      title: 'Позвонить маме',
      date: '2026-09-28',
      reminder: '09:00',
      rrule: null,
    })
    expect(p('Окей Google, напомни мне купить молоко в 18:30')).toMatchObject({
      title: 'Купить молоко',
      date: '2026-09-27',
      reminder: '18:30',
    })
    expect(p('послезавтра в 7 вечера кино')).toMatchObject({ title: 'Кино', date: '2026-09-29', reminder: '19:00' })
    expect(p('в пятницу сдать отчёт')).toMatchObject({ title: 'Сдать отчёт', date: '2026-10-02', reminder: null })
    expect(p('в воскресенье позвонить бабушке')).toMatchObject({ date: '2026-10-04' })
    expect(p('5 октября день рождения Димы')).toMatchObject({ title: 'День рождения Димы', date: '2026-10-05' })
    expect(p('15.09 оплатить страховку')).toMatchObject({ date: '2027-09-15' })
    expect(p('через неделю к стоматологу')).toMatchObject({ title: 'К стоматологу', date: '2026-10-04' })
  })

  it('treats a passed time without a day as tomorrow', () => {
    expect(p('в 9 зарядка')).toMatchObject({ date: '2026-09-28', reminder: '09:00' })
    expect(p('в 11 зарядка')).toMatchObject({ date: '2026-09-27', reminder: '11:00' })
  })

  it('parses relative moments', () => {
    expect(p('через 30 минут выключить духовку')).toMatchObject({
      title: 'Выключить духовку',
      date: '2026-09-27',
      reminder: '10:45',
    })
    expect(p('через 2 часа забрать посылку')).toMatchObject({ reminder: '12:15' })
  })

  it('parses repeats', () => {
    expect(p('каждый понедельник спортзал в 19:30')).toEqual({
      title: 'Спортзал',
      date: '2026-09-28',
      reminder: '19:30',
      rrule: presetRule('weekly', '2026-09-28'),
    })
    expect(p('по будням стендап в 10:00')).toMatchObject({ title: 'Стендап', rrule: presetRule('weekdays', '2026-09-28') })
    expect(p('пить воду каждый день')).toMatchObject({ title: 'Пить воду', rrule: presetRule('daily', '2026-09-27') })
    expect(p('ежемесячно платить за квартиру')).toMatchObject({ rrule: presetRule('monthly', '2026-09-27') })
  })

  it('keeps words that only look like dates inside the title', () => {
    expect(p('купить среду для рыбок')).toMatchObject({ title: 'Купить среду для рыбок', date: '2026-09-27' })
    expect(p('прочитать «Завтрак у Тиффани»')).toMatchObject({ date: '2026-09-27' })
  })
})

describe('quick add, English', () => {
  it('parses day, time and repeat', () => {
    expect(p('remind me to pay rent on friday at 6pm')).toEqual({
      title: 'Pay rent',
      date: '2026-10-02',
      reminder: '18:00',
      rrule: null,
    })
    expect(p('tomorrow 9:30am dentist')).toMatchObject({ title: 'Dentist', date: '2026-09-28', reminder: '09:30' })
    expect(p('gym every monday at 7')).toMatchObject({ title: 'Gym', date: '2026-09-28', rrule: presetRule('weekly', '2026-09-28') })
    expect(p('water plants daily')).toMatchObject({ title: 'Water plants', rrule: presetRule('daily', '2026-09-27') })
    expect(p('call John in 2 hours')).toMatchObject({ title: 'Call John', reminder: '12:15' })
    expect(p('Oct 12 passport renewal')).toMatchObject({ title: 'Passport renewal', date: '2026-10-12' })
  })

  it('falls back to the raw text', () => {
    expect(p('tomorrow')).toMatchObject({ title: 'Tomorrow', date: '2026-09-28' })
  })
})
