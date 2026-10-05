import { fmt, fmtWeekday, t } from '../i18n'
import { dayContainer } from '../actions'
import { useBoard } from '../board'
import { fromISODate, isWeekend } from '../lib/dates'
import { Column } from './Column'

function DayHeader({ date }: { date: string }) {
  const { today, goToDate } = useBoard()
  const d = fromISODate(date)
  return (
    <header className={`day-header${date === today ? ' today' : ''}`}>
      <button className="day-date" aria-label={`${fmt(d, 'd MMMM yyyy')} · ${t('openMonth')}`} onClick={() => goToDate(date, 'month')} title={t('openMonth')}>
        <span className="day-num">{fmt(d, 'd')}</span>
        <span className="day-month">{fmt(d, 'MMM')}</span>
      </button>
      <span className="day-name">{fmtWeekday(d)}</span>
    </header>
  )
}

export function WeekView({ days }: { days: string[] }) {
  const { settings, today } = useBoard()
  const layout = settings.weekStartsOn === 1 ? settings.weekendLayout : settings.weekendLayout === 'hidden' ? 'hidden' : 'full'
  const weekdays = days.filter((d) => !isWeekend(d))
  const weekend = days.filter(isWeekend)
  const cls = (d: string) => `day${d === today ? ' is-today' : ''}${d < today ? ' past' : ''}`

  if (layout === 'compact') {
    return (
      <div className="week" style={{ '--cols': 6 } as React.CSSProperties}>
        {weekdays.map((d) => (
          <Column key={d} date={d} container={dayContainer(d)} className={cls(d)} header={<DayHeader date={d} />} />
        ))}
        <div className="weekend-stack">
          {weekend.map((d) => (
            <Column key={d} date={d} container={dayContainer(d)} className={cls(d)} header={<DayHeader date={d} />} />
          ))}
        </div>
      </div>
    )
  }
  const shown = layout === 'hidden' ? weekdays : days
  return (
    <div className="week" style={{ '--cols': shown.length } as React.CSSProperties}>
      {shown.map((d) => (
        <Column key={d} date={d} container={dayContainer(d)} className={cls(d)} header={<DayHeader date={d} />} />
      ))}
    </div>
  )
}
