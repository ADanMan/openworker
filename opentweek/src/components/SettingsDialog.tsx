import { useState } from 'react'
import { deleteCalendar, newTask } from '../actions'
import { db, uid, updateSettings } from '../db'
import { refreshFeed } from '../hooks/background'
import { useCalendars, useFeeds } from '../hooks/data'
import { toast } from '../hooks/toast'
import { download, exportBackup, importBackup, type Backup } from '../lib/backup'
import { exportICS, parseTasks } from '../lib/ics'
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
    <Dialog title="Settings" onClose={onClose} className="settings">
      <section>
        <h3>Appearance</h3>
        <label className="setting">
          Theme
          <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div className="setting">
          Accent
          <ColorSelect value={settings.accent} onChange={(accent) => set({ accent })} />
        </div>
        <label className="setting">
          Paper
          <select value={settings.paper} onChange={(e) => set({ paper: e.target.value as Settings['paper'] })}>
            <option value="lined">Lined</option>
            <option value="dotted">Dotted</option>
            <option value="plain">Plain (extra minimal)</option>
          </select>
        </label>
        <label className="setting">
          Text size
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
        <h3>Calendar</h3>
        <label className="setting">
          Week starts on
          <select
            value={settings.weekStartsOn}
            onChange={(e) => set({ weekStartsOn: Number(e.target.value) as Settings['weekStartsOn'] })}
          >
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
            <option value={6}>Saturday</option>
          </select>
        </label>
        <label className="setting">
          Weekend
          <select
            value={settings.weekendLayout}
            onChange={(e) => set({ weekendLayout: e.target.value as Settings['weekendLayout'] })}
          >
            <option value="compact">Stacked (Sat + Sun in one column)</option>
            <option value="full">Full columns</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.showWeekNumbers}
            onChange={(e) => set({ showWeekNumbers: e.target.checked })}
          />
          Show week numbers
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.hideCompleted}
            onChange={(e) => set({ hideCompleted: e.target.checked })}
          />
          Hide completed tasks
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.autoRollover}
            onChange={(e) => set({ autoRollover: e.target.checked })}
          />
          Move unfinished tasks to today automatically
        </label>
        <label className="setting check-setting">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={async (e) => {
              const on = e.target.checked
              if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
                const p = await Notification.requestPermission()
                if (p !== 'granted') return toast('Notifications are blocked in this browser')
              }
              await set({ notifications: on })
            }}
          />
          Reminder notifications
        </label>
      </section>

      <section>
        <h3>Calendars</h3>
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
                aria-label={`Delete ${c.name}`}
                onClick={async () => {
                  if (!confirm(`Delete calendar "${c.name}" with all its tasks?`)) return
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
              await db.calendars.add({ id, name: 'New calendar', color: 'green', order: calendars.length })
              await db.lists.add({ id: uid(), calendarId: id, name: 'Someday', order: 0 })
            })
            await set({ activeCalendarId: id })
          }}
        >
          <Icon name="plus" size={14} /> Add calendar
        </button>
      </section>

      <section>
        <h3>Subscribed calendars (read-only)</h3>
        <p className="muted small">
          Paste an iCal / webcal link, such as Google Calendar's "Secret address in iCal format", an Apple iCloud
          public calendar or an Outlook ICS link. Events show on your week.
        </p>
        <ul className="manage-list">
          {feeds.map((f) => (
            <li key={f.id}>
              <input
                type="checkbox"
                checked={f.enabled}
                aria-label="Show"
                onChange={(e) => db.feeds.update(f.id, { enabled: e.target.checked })}
              />
              <input defaultValue={f.name} onBlur={(e) => db.feeds.update(f.id, { name: e.target.value })} />
              <ColorSelect value={f.color} onChange={(color) => db.feeds.update(f.id, { color })} />
              <span className={`muted small${f.error ? ' error' : ''}`} title={f.url}>
                {f.error ?? (f.fetchedAt ? `${f.events.length} events` : 'not synced')}
              </span>
              <button className="icon-btn subtle" aria-label="Refresh" onClick={() => refreshFeed(f, settings.corsProxy)}>
                <Icon name="repeat" size={14} />
              </button>
              <button className="icon-btn subtle" aria-label="Remove" onClick={() => db.feeds.delete(f.id)}>
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
            const feed = {
              id: uid(),
              name: new URL(feedUrl.replace(/^webcal:/i, 'https:')).hostname,
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
            Subscribe
          </button>
        </form>
        <label className="setting">
          CORS proxy
          <input
            placeholder="https://proxy.example/?url={url}"
            defaultValue={settings.corsProxy}
            onBlur={(e) => set({ corsProxy: e.target.value.trim() })}
          />
        </label>
      </section>

      <section>
        <h3>Data</h3>
        <p className="muted small">Everything is stored locally in this browser (IndexedDB). Back it up regularly.</p>
        <div className="button-row">
          <button
            className="btn"
            onClick={async () =>
              download(
                `opentweek-backup-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(await exportBackup()),
                'application/json',
              )
            }
          >
            Export backup (.json)
          </button>
          <button
            className="btn"
            onClick={async () => {
              const file = await pickFile('application/json,.json')
              if (!file || !confirm('Replace ALL current data with this backup?')) return
              try {
                await importBackup(JSON.parse(await file.text()) as Backup)
                toast('Backup restored')
              } catch (e) {
                toast(`Import failed: ${String(e)}`)
              }
            }}
          >
            Restore backup
          </button>
          <button
            className="btn"
            onClick={async () => {
              const tasks = await db.tasks.where('calendarId').equals(settings.activeCalendarId).toArray()
              download(`${active?.name ?? 'opentweek'}.ics`, exportICS(tasks, active?.name ?? 'opentweek'), 'text/calendar')
            }}
          >
            Export calendar (.ics)
          </button>
          <button
            className="btn"
            onClick={async () => {
              const file = await pickFile('text/calendar,.ics')
              if (!file) return
              try {
                const parsed = parseTasks(await file.text())
                await db.tasks.bulkAdd(
                  parsed.map((t, i) =>
                    newTask({ ...t, calendarId: settings.activeCalendarId, order: Date.now() + i }),
                  ),
                )
                toast(`Imported ${parsed.length} tasks`)
              } catch (e) {
                toast(`Import failed: ${String(e)}`)
              }
            }}
          >
            Import .ics as tasks
          </button>
        </div>
      </section>
    </Dialog>
  )
}
