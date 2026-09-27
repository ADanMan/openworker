import { addDays, format } from 'date-fns'
import { presetRule, type RepeatPreset } from './recurrence'

/**
 * Natural-language quick add, Russian and English:
 *   "завтра в 9 утра позвонить маме"      → «Позвонить маме», tomorrow, 09:00
 *   "каждый понедельник спортзал в 19:30" → «Спортзал», next Monday, weekly, 19:30
 *   "remind me to pay rent on friday at 6pm"
 * Recognised fragments are cut out of the title. Used by voice input and
 * by text shared into the app.
 */
export interface QuickAdd {
  title: string
  /** yyyy-MM-dd */
  date: string
  /** HH:mm */
  reminder: string | null
  rrule: string | null
}

// JS \b is ASCII-only; these boundaries also work for Cyrillic.
const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
const re = (body: string) => new RegExp(`${B}(?:${body})${E}`, 'iu')

const RU_DOW: [string, number][] = [
  ['воскресенье', 0],
  ['понедельник', 1],
  ['вторник', 2],
  ['сред[ауы]', 3],
  ['четверг', 4],
  ['пятниц[ауы]', 5],
  ['суббот[ауы]', 6],
]
const EN_DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const RU_MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const pad = (n: number) => String(n).padStart(2, '0')

/** Next date with the given weekday; `includeToday` decides whether today counts. */
function nextDow(from: Date, dow: number, includeToday: boolean) {
  let diff = (dow - from.getDay() + 7) % 7
  if (diff === 0 && !includeToday) diff = 7
  return addDays(from, diff)
}

function ruDow(word: string): number {
  const w = word.toLowerCase()
  return RU_DOW.find(([stem]) => new RegExp(`^${stem}$`, 'u').test(w))?.[1] ?? -1
}

export function parseQuickAdd(input: string, now = new Date()): QuickAdd {
  let text = ` ${input.trim()} `
  let date: Date | null = null
  let time: [number, number] | null = null
  let repeat: RepeatPreset | null = null

  /** Apply a rule: on match, run `fn` and cut the fragment out of the title. */
  const take = (pattern: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(pattern)
    if (!m || fn(m) === false) return
    text = text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length)
  }

  // Leading command words: "Окей Google, напомни мне…", "remind me to…"
  take(
    /^\s*(?:(?:окей|ok(?:ay)?|hey)\s*,?\s*(?:гугл|google)\s*,?\s*)?(?:напомни(?:те)?|напомнить|добавь(?:те)?|добавить|запиши(?:те)?|записать|создай(?:те)?|создать|remind me(?:\s+to)?|add(?:\s+a)?\s+task|add|todo)?(?:\s+мне)?(?:\s+(?:задачу|задача|дело|task))?\s*[:,-]?/iu,
    (m) => m[0].trim().length > 0,
  )

  // ---- recurrence
  take(re('каждый\\s+день|ежедневно|every\\s*day|daily'), () => void (repeat = 'daily'))
  take(re('по\\s+будням|в\\s+будни|каждый\\s+будний\\s+день|every\\s+weekday|on\\s+weekdays|weekdays'), () => void (repeat = 'weekdays'))
  take(re('каждые\\s+(?:две|2)\\s+недели|раз\\s+в\\s+(?:две|2)\\s+недели|every\\s+(?:other|two|2)\\s+weeks?|biweekly'), () => void (repeat = 'biweekly'))
  take(re('каждую\\s+неделю|еженедельно|every\\s+week|weekly'), () => void (repeat = 'weekly'))
  take(re('каждый\\s+месяц|ежемесячно|every\\s+month|monthly'), () => void (repeat = 'monthly'))
  take(re('каждый\\s+год|ежегодно|every\\s+year|yearly|annually'), () => void (repeat = 'yearly'))
  take(re(`кажд(?:ый|ую|ое)\\s+(${RU_DOW.map(([s]) => s).join('|')})`), (m) => {
    date = nextDow(now, ruDow(m[1]), true)
    repeat = 'weekly'
  })
  take(re(`every\\s+(${EN_DOW.join('|')})s?`), (m) => {
    date = nextDow(now, EN_DOW.indexOf(m[1].toLowerCase()), true)
    repeat = 'weekly'
  })

  // ---- relative time "через 30 минут" / "in 2 hours" → a moment, not just a day
  take(
    re('через\\s+(полчаса|час|(\\d+)\\s+(минут[уы]?|час(?:а|ов)?))|in\\s+(half\\s+an\\s+hour|an\\s+hour|(\\d+)\\s+(minutes?|mins?|hours?))'),
    (m) => {
      let minutes = 0
      const word = (m[1] ?? m[4] ?? '').toLowerCase()
      const n = Number(m[2] ?? m[5] ?? 1)
      const unit = (m[3] ?? m[6] ?? '').toLowerCase()
      if (word === 'полчаса' || word.startsWith('half')) minutes = 30
      else if (word === 'час' || word === 'an hour') minutes = 60
      else minutes = /^(час|hour)/.test(unit) ? n * 60 : n
      const at = new Date(now.getTime() + minutes * 60_000)
      date = at
      time = [at.getHours(), at.getMinutes()]
    },
  )

  // ---- time of day (before dates, so "в 9.30" is not read as a date)
  take(re('в\\s+полдень|at\\s+noon|noon'), () => void (time = [12, 0]))
  take(re('в\\s+полночь|at\\s+midnight|midnight'), () => void (time = [0, 0]))
  take(
    re('(?:в|к|at)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час(?:а|ов)?)\\.?)?(?:\\s*(утра|дня|вечера|ночи|am|pm|a\\.m\\.|p\\.m\\.))?'),
    (m) => setTime(m[1], m[2], m[3]),
  )
  take(re('(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|утра|вечера)|(\\d{1,2}):(\\d{2})'), (m) =>
    m[1] ? setTime(m[1], m[2], m[3]) : setTime(m[4], m[5], undefined),
  )

  function setTime(h: string, min: string | undefined, part: string | undefined) {
    let hour = Number(h)
    const minute = Number(min ?? 0)
    const p = (part ?? '').toLowerCase().replaceAll('.', '')
    if ((p === 'вечера' || p === 'дня' || p === 'pm') && hour < 12) hour += 12
    if ((p === 'ночи' || p === 'утра' || p === 'am') && hour === 12) hour = 0
    if (hour > 23 || minute > 59) return false
    time = [hour, minute]
  }

  // ---- days
  take(re('послезавтра|day\\s+after\\s+tomorrow'), () => void (date = addDays(now, 2)))
  take(re('завтра|tomorrow'), () => void (date = addDays(now, 1)))
  take(re('сегодня|today|tonight'), () => void (date = now))
  take(re('через\\s+(\\d+|неделю)\\s*(дн(?:я|ей)|день)?|in\\s+(\\d+)\\s+(days?|weeks?)|in\\s+a\\s+week'), (m) => {
    if (m[1] === 'неделю' || /in\s+a\s+week/i.test(m[0])) date = addDays(now, 7)
    else if (m[1]) date = addDays(now, Number(m[1]))
    else date = addDays(now, Number(m[3]) * (/^week/i.test(m[4]) ? 7 : 1))
  })
  take(re(`(?:в|во|на)\\s+(${RU_DOW.map(([s]) => s).join('|')})`), (m) => {
    date = nextDow(now, ruDow(m[1]), false)
  })
  take(re(`(?:on|next|this)?\\s*(${EN_DOW.join('|')})`), (m) => {
    date = nextDow(now, EN_DOW.indexOf(m[1].toLowerCase()), false)
  })
  const inFuture = (month: number, day: number) => {
    let d = new Date(now.getFullYear(), month, day)
    if (iso(d) < iso(now)) d = new Date(now.getFullYear() + 1, month, day)
    return d
  }
  take(re(`(\\d{1,2})\\s+(${RU_MONTHS.join('|')})[а-яё]*`), (m) => {
    const month = RU_MONTHS.findIndex((s) => new RegExp(`^${s}`, 'iu').test(m[2]))
    date = inFuture(month, Number(m[1]))
  })
  take(re(`(${EN_MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${EN_MONTHS.join('|')})[a-z]*`), (m) => {
    const name = (m[1] ?? m[4]).toLowerCase().slice(0, 3)
    date = inFuture(EN_MONTHS.indexOf(name), Number(m[2] ?? m[3]))
  })
  take(re('(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?'), (m) => {
    const day = Number(m[1])
    const month = Number(m[2]) - 1
    if (month > 11 || day > 31) return false
    if (m[3]) {
      const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3])
      date = new Date(y, month, day)
    } else date = inFuture(month, day)
  })

  // A time alone that has already passed today means tomorrow.
  if (!date && time) {
    const [h, m] = time as [number, number]
    date = h * 60 + m <= now.getHours() * 60 + now.getMinutes() ? addDays(now, 1) : now
  }
  const day = iso((date as Date | null) ?? now)

  let title = text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;–—-]+|[\s,.:;–—-]+$/g, '')
    // dangling connectors left at the edges after cutting fragments out;
    // prepositions at the start stay ("к стоматологу", "на почту")
    .replace(new RegExp(`^(?:(?:и|что|чтобы|to|about|and)${E}\\s*)+`, 'iu'), '')
    .replace(new RegExp(`(?:\\s+${B}(?:и|в|во|на|к|at|on|to|and))+$`, 'iu'), '')
    .trim()
  if (!title) title = input.trim()
  title = title.charAt(0).toLocaleUpperCase() + title.slice(1)

  const t = time as [number, number] | null
  return {
    title,
    date: day,
    reminder: t ? `${pad(t[0])}:${pad(t[1])}` : null,
    rrule: repeat ? presetRule(repeat, day) : null,
  }
}
