import { fmt, t, type Key } from '../i18n'
import { useState } from 'react'
import {
  customToRule,
  describe,
  detectPreset,
  parseCustom,
  presetRule,
  type CustomRule,
  type RepeatPreset,
} from '../lib/recurrence'

const PRESETS: [RepeatPreset, Key][] = [
  ['none', 'repeatNone'],
  ['daily', 'repeatDaily'],
  ['weekdays', 'repeatWeekdays'],
  ['weekly', 'repeatWeekly'],
  ['biweekly', 'repeatBiweekly'],
  ['monthly', 'repeatMonthly'],
  ['yearly', 'repeatYearly'],
  ['custom', 'repeatCustom'],
]
// Monday-first order; values are JS weekday indexes (0 = Sunday). 2024-01-07 is a Sunday.
const DOW = [1, 2, 3, 4, 5, 6, 0]
const dowLabel = (d: number) => fmt(new Date(2024, 0, 7 + d), 'EEEEE')

export function RepeatEditor({
  date,
  rrule,
  onChange,
}: {
  date: string | null
  rrule: string | null
  onChange: (rrule: string | null) => void
}) {
  const [preset, setPreset] = useState<RepeatPreset>(() => detectPreset(rrule, date))
  if (!date) return <p className="muted small">{t('repeatNeedsDay')}</p>

  const custom = parseCustom(rrule, date)
  const setCustom = (patch: Partial<CustomRule>) => onChange(customToRule({ ...custom, ...patch }))

  return (
    <div className="repeat">
      <select
        value={preset}
        onChange={(e) => {
          const p = e.target.value as RepeatPreset
          setPreset(p)
          onChange(presetRule(p, date))
        }}
      >
        {PRESETS.map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
      {preset === 'custom' && (
        <div className="repeat-custom">
          <label>
            {t('every')}
            <input
              type="number"
              min={1}
              value={custom.interval}
              onChange={(e) => setCustom({ interval: Number(e.target.value) || 1 })}
            />
            <select value={custom.freq} onChange={(e) => setCustom({ freq: e.target.value as CustomRule['freq'] })}>
              <option value="DAILY">{t('days')}</option>
              <option value="WEEKLY">{t('weeks')}</option>
              <option value="MONTHLY">{t('months')}</option>
              <option value="YEARLY">{t('years')}</option>
            </select>
          </label>
          {custom.freq === 'WEEKLY' && (
            <div className="dow-picker">
              {DOW.map((i) => (
                <button
                  key={i}
                  className={custom.weekdays.includes(i) ? 'on' : ''}
                  onClick={() =>
                    setCustom({
                      weekdays: custom.weekdays.includes(i)
                        ? custom.weekdays.filter((d) => d !== i)
                        : [...custom.weekdays, i],
                    })
                  }
                >
                  {dowLabel(i)}
                </button>
              ))}
            </div>
          )}
          <label>
            {t('ends')}
            <select value={custom.end} onChange={(e) => setCustom({ end: e.target.value as CustomRule['end'] })}>
              <option value="never">{t('endsNever')}</option>
              <option value="until">{t('endsOn')}</option>
              <option value="count">{t('endsAfter')}</option>
            </select>
            {custom.end === 'until' && (
              <input type="date" value={custom.until} onChange={(e) => setCustom({ until: e.target.value })} />
            )}
            {custom.end === 'count' && (
              <input
                type="number"
                min={1}
                value={custom.count}
                onChange={(e) => setCustom({ count: Number(e.target.value) || 1 })}
              />
            )}
          </label>
        </div>
      )}
      {rrule && <p className="muted small">{t('repeats', { rule: describe({ date, rrule }) })}</p>}
    </div>
  )
}
