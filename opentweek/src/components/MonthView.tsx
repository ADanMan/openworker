import { fmt, fmtWeekday, t } from '../i18n'
import { dayContainer } from '../actions'
import { useBoard } from '../board'
import { fromISODate, isWeekend, weekNumber } from '../lib/dates'
import { Column } from './Column'

export function MonthView({ weeks, month }: { weeks: string[][]; month: number }) {
  const { settings, today, goToDate, items, events } = useBoard()
  const hideWeekend = settings.weekendLayout === 'hidden'
  const cols = hideWeekend ? 5 : 7
  return (
    <div className="month" style={{ '--cols': cols } as React.CSSProperties}>
      <div className="month-row month-head">
        {settings.showWeekNumbers && <span className="wk" />}
        {weeks[0]
          .filter((d) => !hideWeekend || !isWeekend(d))
          .map((d) => (
            <span key={d} className="month-dow">
              {fmtWeekday(fromISODate(d))}
            </span>
          ))}
      </div>
      {weeks.map((week) => (
        <div className="month-row" key={week[0]}>
          {settings.showWeekNumbers && (
            <button className="wk" onClick={() => goToDate(week[0], 'week')} title={t('openWeek')}>
              {weekNumber(week[3])}
            </button>
          )}
          {week
            .filter((d) => !hideWeekend || !isWeekend(d))
            .map((d) => {
              const date = fromISODate(d)
              const count = items(dayContainer(d)).length + events(d).length
              const ending = count % 10 === 1 && count % 100 !== 11 ? 'дело' : [2,3,4].includes(count % 10) && ![12,13,14].includes(count % 100) ? 'дела' : 'дел'
              return (
                <Column
                  key={d}
                  date={d}
                  container={dayContainer(d)}
                  className={`cell${d === today ? ' is-today' : ''}${date.getMonth() !== month ? ' other-month' : ''}`}
                  header={
                    <header className={`cell-header${d === today ? ' today' : ''}`}>
                      <button aria-label={`${fmt(date, 'd MMMM yyyy')} · ${t('openWeek')}${count ? ` · ${count}` : ''}`} onClick={() => goToDate(d, 'week')}>
                        {fmt(date, 'd')}<span className="month-count">{count ? `${count} ${ending}` : ''}</span>
                      </button>
                    </header>
                  }
                />
              )
            })}
        </div>
      ))}
    </div>
  )
}
