# opentweek

An open-source, local-first weekly planner inspired by [Tweek](https://tweek.so). The goal is the same calm "paper week" UX, with every Tweek Premium feature included and free.

- **No account, no server.** Your data lives in your browser's IndexedDB and works offline as an installable PWA.
- **Stack:** React 19, TypeScript, Vite 8, Dexie 4, dnd-kit, date-fns 4, rrule, ical.js and vite-plugin-pwa. Every dependency is MIT, Apache-2.0, BSD or MPL-2.0.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: recurrence, ICS, share links, drag & drop logic
npm run build      # static PWA in dist/, host it anywhere
```

## Features vs Tweek

| Feature | Tweek Free | Tweek Premium | opentweek |
|---|:-:|:-:|:-:|
| Week view of lined "paper" days, inline typing | ✓ | ✓ | ✓ |
| Drag & drop between days, lists, reorder (mouse, touch, keyboard) | ✓ | ✓ | ✓ |
| Someday lists under the week | 3 | unlimited | unlimited |
| Calendars (Personal / Work…) | 2 | unlimited | unlimited |
| Task colors | 2 | unlimited | 9 + none |
| Notes on tasks | ✓ | ✓ | ✓ |
| Dark mode, start week on any day | ✓ | ✓ | ✓ |
| Printable week | ✓ | ✓ | ✓ (`P`, landscape print CSS) |
| Share a task by link | ✓ | ✓ | ✓ (server-less: the task is in the URL fragment) |
| **Month view** | – | ✓ | ✓ (drag & drop works there too) |
| **Recurring tasks**: daily/weekdays/weekly/2-weekly/monthly/yearly/custom, with end date or count | – | ✓ | ✓ (per-occurrence done, skip, "edit only this one") |
| **Subtasks** | – | ✓ | ✓ |
| **Attachments** (files and images) | – | ✓ | ✓ (stored locally as blobs) |
| **Reminders** | – | ✓ push/email | ✓ local notifications while the app is open |
| **Google / Apple / Outlook calendar** | – | ✓ sync | ✓ read-only ICS subscriptions + `.ics` import/export |
| **Themes** | – | ✓ | ✓ system/light/dark, 9 accents, lined/dotted/plain paper, text size |
| **Hide completed tasks** | – | ✓ | ✓ (`H`) |
| Weekend layout (stacked / full / hidden) | – | roadmap | ✓ |
| Auto-move unfinished tasks to today | – | – | ✓ |
| Search across tasks, notes and subtasks | – | – | ✓ (`/`, `Ctrl+K`) |
| Keyboard shortcuts | partial | partial | ✓ (`?` for the list) |
| Undo delete, JSON backup/restore | – | – | ✓ |
| Real-time collaboration | ✓ | ✓ | roadmap |

## Architecture

```
src/
  types.ts            data model: Task, SomedayList, Calendar, Feed, Settings
  db.ts               Dexie schema, settings, first-run seed
  actions.ts          all mutations: add/move/reorder/detach occurrence/rollover
  lib/recurrence.ts   RRULE <-> presets/custom editor, occurrence expansion
  lib/ics.ts          ICS export (RFC 5545 folding/escaping), feed & task import
  lib/share.ts        deflate + base64url share links (#share=…)
  lib/backup.ts       JSON backup including attachments
  hooks/              live queries, reminders, rollover, feed sync, toasts
  components/         WeekView, MonthView, Column, TaskRow, SomedayPanel, dialogs
```

Key decisions:

- **A repeating task is one row** with `rrule`, `exdates` and `doneDates`. Occurrences are expanded on the fly for the visible range, so there are no materialised copies to keep in sync. Dragging one occurrence to another day detaches it into a standalone task and adds an `EXDATE` to the series.
- **Dates are `yyyy-MM-dd` strings.** Tasks are day-scoped, and rrule runs in floating UTC, so a task never shifts across time zones.
- **A container id is `day:<date>` or `list:<id>`.** One DnD context covers the week or month grid and the Someday lists.
- **Local-first by default.** Sync is a separate layer on top of Dexie (see the roadmap).

## Roadmap

- [ ] Sync and real-time sharing. Candidates: Yjs + y-websocket, which is self-hostable and a natural fit for shared calendars, or Dexie Cloud / PowerSync.
- [ ] Two-way Google Calendar sync via OAuth. Currently it is read-only via the secret ICS address.
- [ ] Web Push reminders when the app is closed. This needs a small push server.
- [ ] Recurring subtasks per occurrence, and drag-reordering of subtasks.
- [ ] i18n (ru/en first). Tauri/Capacitor wrappers for desktop and mobile.

See [docs/RESEARCH.md](docs/RESEARCH.md) for the references and library comparison this is based on.

## License

MIT
