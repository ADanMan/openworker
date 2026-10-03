# OpenTweek local feelings journal

User-authorized implementation for Android, with no cloud speech/LLM fallback.

- Separate journalEntries store; preserve existing planner tables and v1 backups. Each entry has id, local date, text, optional self-reported mood 1..5, timestamps. No inferred diagnosis.
- Journal supports typed entries everywhere; Android local dictation produces an editable draft. Explicit save only; a stable draft id prevents duplicate saves. Cancel never writes.
- Native Vosk small Russian 0.22 is the initial engine: official Android library, Apache-2.0 model (~45 MB archive per publisher). Download only by explicit button; verify pinned checksum, bounded extraction, atomically install; no model blobs in Git. Audio remains in RAM and is discarded. Recognition contains no network calls.
- UI distinguishes loading/downloading/ready/recording/processing/error; stop, cancel and recording duration visible. Permissions requested only by a user action. Stop recording when journal closes or activity leaves foreground for this release. No background listener shipped unless a Russian wake detector is actually validated.
- Wake phrase «эй, Твик» is a feasibility gate: check Vosk vocabulary, do not substitute similar words or claim reliable detection. If unavailable, ship button dictation and document precise remaining work; no pretend wake toggle.
- Existing system-recognition task button must not be reused by journal. Explain existing legacy task voice separately or replace it with local flow to avoid sending new speech externally.
- Backup is local plaintext export, includes journal in v2; importing old planner backup must not erase existing journal. Validate all journal rows before mutation; rollback on invalid data.
- Android origin/package unchanged to preserve IndexedDB. Signing identity compatibility must be reported; never tell user to uninstall existing app to bypass it. Existing signing key will not be read or exposed. Build unsigned/debug artifact if private signing unavailable.
- No phone install, microphone use, or paid API. Device-only tests explicitly remain pending.
