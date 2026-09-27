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

const PRESETS: [RepeatPreset, string][] = [
  ['none', 'Does not repeat'],
  ['daily', 'Every day'],
  ['weekdays', 'Every weekday (Mon–Fri)'],
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
  ['yearly', 'Every year'],
  ['custom', 'Custom…'],
]
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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
  if (!date) return <p className="muted small">Put the task on a day to make it repeat.</p>

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
            {label}
          </option>
        ))}
      </select>
      {preset === 'custom' && (
        <div className="repeat-custom">
          <label>
            Every
            <input
              type="number"
              min={1}
              value={custom.interval}
              onChange={(e) => setCustom({ interval: Number(e.target.value) || 1 })}
            />
            <select value={custom.freq} onChange={(e) => setCustom({ freq: e.target.value as CustomRule['freq'] })}>
              <option value="DAILY">day(s)</option>
              <option value="WEEKLY">week(s)</option>
              <option value="MONTHLY">month(s)</option>
              <option value="YEARLY">year(s)</option>
            </select>
          </label>
          {custom.freq === 'WEEKLY' && (
            <div className="dow-picker">
              {DOW.map((label, i) => (
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
                  {label}
                </button>
              ))}
            </div>
          )}
          <label>
            Ends
            <select value={custom.end} onChange={(e) => setCustom({ end: e.target.value as CustomRule['end'] })}>
              <option value="never">never</option>
              <option value="until">on date</option>
              <option value="count">after N times</option>
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
      {rrule && <p className="muted small">Repeats {describe({ date, rrule })}</p>}
    </div>
  )
}
