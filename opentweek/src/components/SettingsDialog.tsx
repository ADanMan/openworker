import { useState } from 'react'
import { deleteCalendar, newTask } from '../actions'
import { db, uid, updateSettings } from '../db'
import { refreshFeed } from '../hooks/background'
import { useCalendars, useFeeds } from '../hooks/data'
import { toast } from '../hooks/toast'
import { t } from '../i18n'
import { exportBackup, importBackup, type Backup } from '../lib/backup'
import { exportICS, parseTasks } from '../lib/ics'
import { isNative, requestNotificationPermission, saveFile } from '../native'
import { COLORS, type ColorKey, type Settings } from '../types'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

function ColorSelect({ value, onChange }: { value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <div className="swatches small">
      {COLORS.filter((c) => c !== 'none').map((c) => (
        <button
          key={c}
          aria-label={c}
          className={`swatch color-${c}${value === c ? ' on' : ''}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

const pickFile = (accept: string) =>
  new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })

export function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const calendars = useCalendars()
  const feeds = useFeeds()
  const [feedUrl, setFeedUrl] = useState('')
  const set = (patch: Partial<Settings>) => updateSettings(patch)
  const active = calendars.find((c) => c.id === settings.activeCalendarId)

  return (
    <Dialog title={t('settings')} onClose={onClose} className="settings">
      <section>
        <h3>{t('appearance')}</h3>
        <label className="setting">
          {t('language')}
          <select value={settings.language} onChange={(e) => set({ language: e.target.value as Settings['language'] })}>
            <option value="auto">{t('languageAuto')}</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="setting">
          {t('theme')}
          <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">{t('themeSystem')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </label>
        <div className="setting">
          {t('accent')}
          <ColorSelect value={settings.accent} onChange={(accent) => set({ accent })} />
        </div>
        <label className="setting">
          {t('paper')}
          <select value={settings.paper} onChange={(e) => set({ paper: e.target.value as Settings['paper'] })}>
            <option value="lined">{t('paperLined')}</option>
            <option value="dotted">{t('paperDotted')}</option>
            <option value="plain">{t('paperPlain')}</option>
          </select>
        </label>
        <label className="setting">
          {t('textSize')}
          <input
            type="range"
            min={0.85}
            max={1.3}
            step={0.05}
            value={settings.fontScale}
            onChange={(e) => set({ fontScale: Number(e.target.value) })}
          />
        </label>
      </section>

      <section>
        <h3>{t('calendar')}</h3>
        <label className="setting">
          {t('weekStartsOn')}
          <select
            value={settings.weekStartsOn}
            onChange={(e) => set({ weekStartsOn: Number(e.target.value) as Settings['weekStartsOn'] })}
          >
            <option value={1}>{t('monday')}</option>
            <option value={0}>{t('sunday')}</option>
            <option value={6}>{t('saturday')}</option>
          </select>
        </label>
        <label className="setting">
          {t('weekend')}
          <select
            value={settings.weekendLayout}
            onChange={(e) => set({ weekendLayout: e.target.value as Settings['weekendLayout'] })}
          >
            <option value="compact">{t('weekendCompact')}</option>
            <option value="full">{t('weekendFull')}</option>
            <option value="hidden">{t('weekendHidden')}</option>
          </select>
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.showWeekNumbers}
            onChange={(e) => set({ showWeekNumbers: e.target.checked })}
          />
          {t('showWeekNumbers')}
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.hideCompleted}
            onChange={(e) => set({ hideCompleted: e.target.checked })}
          />
          {t('hideCompletedTasks')}
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.autoRollover}
            onChange={(e) => set({ autoRollover: e.target.checked })}
          />
          {t('autoRollover')}
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={async (e) => {
              const on = e.target.checked
              if (on && !(await requestNotificationPermission())) return toast(t('notificationsBlocked'))
              await set({ notifications: on })
            }}
          />
          {t('reminderNotifications')}
        </label>
      </section>

      <section>
        <h3>{t('calendars')}</h3>
        <ul className="manage-list">
          {calendars.map((c) => (
            <li key={c.id}>
              <span className={`dot color-${c.color}`} />
              <input
                defaultValue={c.name}
                onBlur={(e) => e.target.value.trim() && db.calendars.update(c.id, { name: e.target.value.trim() })}
              />
              <ColorSelect value={c.color} onChange={(color) => db.calendars.update(c.id, { color })} />
              <button
                className="icon-btn subtle"
                disabled={calendars.length < 2}
                aria-label={t('deleteCalendar', { name: c.name })}
                onClick={async () => {
                  if (!confirm(t('confirmDeleteCalendar', { name: c.name }))) return
                  if (c.id === settings.activeCalendarId) {
                    await set({ activeCalendarId: calendars.find((x) => x.id !== c.id)!.id })
                  }
                  await deleteCalendar(c.id)
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button
          className="btn"
          onClick={async () => {
            const id = uid()
            await db.transaction('rw', db.calendars, db.lists, async () => {
              await db.calendars.add({ id, name: t('newCalendar'), color: 'green', order: calendars.length })
              await db.lists.add({ id: uid(), calendarId: id, name: t('someday'), order: 0 })
            })
            await set({ activeCalendarId: id })
          }}
        >
          <Icon name="plus" size={14} /> {t('addCalendar')}
        </button>
      </section>

      <section>
        <h3>{t('subscriptions')}</h3>
        <p className="muted small">{t('subscriptionsHint')}</p>
        <ul className="manage-list">
          {feeds.map((f) => (
            <li key={f.id}>
              <input
                type="checkbox"
                checked={f.enabled}
                aria-label={t('show')}
                onChange={(e) => db.feeds.update(f.id, { enabled: e.target.checked })}
              />
              <input defaultValue={f.name} onBlur={(e) => db.feeds.update(f.id, { name: e.target.value })} />
              <ColorSelect value={f.color} onChange={(color) => db.feeds.update(f.id, { color })} />
              <span className={`muted small${f.error ? ' error' : ''}`} title={f.url}>
                {f.error ?? (f.fetchedAt ? t('events', { n: f.events.length }) : t('notSynced'))}
              </span>
              <button
                className="icon-btn subtle"
                aria-label={t('refresh')}
                onClick={() => refreshFeed(f, settings.corsProxy)}
              >
                <Icon name="repeat" size={14} />
              </button>
              <button className="icon-btn subtle" aria-label={t('remove')} onClick={() => db.feeds.delete(f.id)}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!feedUrl.trim()) return
            let name = feedUrl
            try {
              name = new URL(feedUrl).hostname
            } catch {
              return toast(t('importFailed', { error: 'URL' }))
            }
            const feed = {
              id: uid(),
              name,
              url: feedUrl.trim(),
              color: 'gray' as const,
              enabled: true,
              events: [],
              fetchedAt: null,
              error: null,
            }
            await db.feeds.add(feed)
            setFeedUrl('')
            await refreshFeed(feed, settings.corsProxy)
          }}
        >
          <input
            type="url"
            placeholder="https://calendar.google.com/…/basic.ics"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value.replace(/^webcal:/i, 'https:'))}
          />
          <button className="btn" type="submit">
            {t('subscribe')}
          </button>
        </form>
        {!isNative && (
          <label className="setting">
            {t('corsProxy')}
            <input
              placeholder="https://proxy.example/?url={url}"
              defaultValue={settings.corsProxy}
              onBlur={(e) => set({ corsProxy: e.target.value.trim() })}
            />
          </label>
        )}
      </section>

      <section>
        <h3>{t('data')}</h3>
        <p className="muted small">{t('dataHint')}</p>
        <div className="button-row">
          <button
            className="btn"
            onClick={async () =>
              saveFile(
                `opentweek-backup-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(await exportBackup()),
                'application/json',
              )
            }
          >
            {t('exportBackup')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const file = await pickFile('application/json,.json')
              if (!file || !confirm(t('confirmRestore'))) return
              try {
                await importBackup(JSON.parse(await file.text()) as Backup)
                toast(t('restored'))
              } catch (e) {
                toast(t('importFailed', { error: String(e) }))
              }
            }}
          >
            {t('restoreBackup')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const tasks = await db.tasks.where('calendarId').equals(settings.activeCalendarId).toArray()
              const name = active?.name ?? 'opentweek'
              await saveFile(`${name}.ics`, exportICS(tasks, name), 'text/calendar')
            }}
          >
            {t('exportIcs')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const file = await pickFile('text/calendar,.ics')
              if (!file) return
              try {
                const parsed = parseTasks(await file.text())
                await db.tasks.bulkAdd(
                  parsed.map((task, i) =>
                    newTask({ ...task, calendarId: settings.activeCalendarId, order: Date.now() + i }),
                  ),
                )
                toast(t('imported', { n: parsed.length }))
              } catch (e) {
                toast(t('importFailed', { error: String(e) }))
              }
            }}
          >
            {t('importIcs')}
          </button>
        </div>
      </section>

      <section>
        <h3>{t('about')}</h3>
        <p className="muted small">
          opentweek · {t('version', { v: __APP_VERSION__ })} · {t('sourceCode')}
        </p>
      </section>
    </Dialog>
  )
}
