# Research notes (2026-09)

## Tweek feature set

Sources: tweek.so/calendar/pricing, /features and /printable; help.tweek.so articles 36 (start week), 106 (dark mode), 111 (shortcuts) and 170 (hide completed); roadmap.tweek.so; the Lifestack and Morgen reviews. The egress proxy blocked tweek.so, so these details come from search snippets.

- **Free:** weekly lined grid, 3 Someday columns, 2 calendars, 2 colors, notes, drag & drop, sharing and collaboration, share-task-by-link, publish to web, dark mode, start-week day, printable week, "Tweek GPT" suggestions.
- **Premium ($5.99/mo, $49.99/yr):** month view, recurring tasks, subtasks, attachments, push/email reminders, Google/Outlook/Apple Calendar and Reminders sync, unlimited calendars/columns/colors, themes, hide completed.
- **Roadmap:** keyboard shortcuts are only partly done. Hiding the weekend is requested but not shipped.

## Libraries chosen

| Need | Choice | License | Alternatives considered |
|---|---|---|---|
| UI | React 19 + Vite 8 + TS | MIT | – |
| Drag & drop | @dnd-kit/core 6 + sortable 10 | MIT | pragmatic-drag-and-drop (Apache-2.0; smaller but lower level, no a11y built in); react-beautiful-dnd (deprecated) |
| Dates | date-fns 4 | MIT | dayjs |
| Recurrence | rrule 2.8 | BSD-3 | rrule-temporal (newer, less proven) |
| Storage | Dexie 4 + dexie-react-hooks | Apache-2.0 | RxDB, plain idb |
| ICS | ical.js 2 | MPL-2.0 | ics (generator only) |
| PWA | vite-plugin-pwa 1.3 | MIT | – |

Sync candidates for later: Yjs + y-indexeddb (MIT), PowerSync (Apache-2.0 client, needs Postgres), ElectricSQL (Apache-2.0, read path), Zero (Apache-2.0) and RxDB. Avoid Triplit (AGPL) and Replicache (proprietary terms) for an MIT project.

## Prior art

- **manuelernestog/weektodo** (Vue, GPL-3.0, about 2.2k stars) is the most complete open weekly planner. It is good UX reference, but its code is **not** reused because GPL is incompatible with MIT.
- **silo/openweek** (TypeScript, 2026, no license) is also an "open alternative to tweek". It has a similar name, so keep that in mind when choosing where to publish.
- **sorenjohanson/weekplanner-nextcloud** (AGPL-3.0) is a Nextcloud app.
- There are small or unlicensed TeuxDeux/Tweek clones (sounishnath003/tweak, jaindravya/tweeklike, several teuxdeux clones). None was worth borrowing code from.

In the end, opentweek is written from scratch on permissively licensed libraries.
