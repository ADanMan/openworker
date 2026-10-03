# Local journal, linked calendar and Russian dictation — 1.3.0 Preview

This page documents 1.3.0. Preview 1.4.0 adds an optional background wake experiment: [conditions and validation](45-experimental-wake.md).

## Calendar and journal

The Calendar and Journal modes share a selected local calendar date (not a UTC timestamp). Each day and task editor can open its journal. Entries link to tasks by `taskId`; recurring items also carry `occurrenceDate`. Titles resolve from the task, never from a duplicated journal snapshot. Opening a linked entry returns to the task's current calendar/date.

Moving a plain task moves linked entry/draft dates. Moving one occurrence relinks to the detached task. Removing a task, series, calendar or list detaches references and preserves private text; Undo restores unchanged references. Recurrence conversion assigns valid occurrence dates, and removing an occurrence detaches its reflections. ICS subscription events use `feedId`, `eventUid` and date. An unavailable external event is shown as unavailable without removing the entry. Feed changes do not rewrite journal dates.

The journal supports free text plus optional thoughts, feelings, body sensations, another perspective, possible action, feelings afterwards and needs. Every field can remain empty; any text field can complete an entry. The optional 1–5 rating is self-reported.

Guidance is static and local. The user explicitly chooses Work, Relationships, Rest, Change or Other. These choices select neutral questions and a vocabulary; no journal text is analyzed, no emotion inferred, and no diagnosis, medical prescription or required positive reframing is provided. User-supplied photographs and personal examples are not included in the repository or APK.

Edits autosave into a separate local draft. Wait for the saved-draft status before force-closing. Save entry finalizes it and removes that draft atomically. Cancel changes restores the last completed entry. Date/mode changes retain drafts and stop microphone capture. Drafts and completed entries appear separately for the selected day.

## Offline Russian voice

The Android editor uses Vosk 0.3.75 / JNA 5.18.1, not Android RecognizerIntent or Web Speech. Choose a target field, tap dictation, review and save. The task voice shortcut uses the same recognizer and a separate review step. Web/PWA supports typing only in this version.

One explicit download installs `vosk-model-small-ru-0.22` from alphacephei.com (Apache-2.0): 46,236,750 bytes, SHA256 `961d5ff98a17f4aa6de69864d0aa71fa5bac682301d2b5d17a3f24c5c99a46d4`; unpacked 91,289,240 bytes. Installation verifies the archive and is cancellable/atomic. Extra space is required for temporary archive plus installed model.

Microphone permission is requested only after tapping Record. Refusal has no cloud fallback. Recognition processes mono 16 kHz PCM in memory, without saving audio or sending it to a speech service. Capture stops manually, after a completed segment followed by three seconds without new partial results, after 15 seconds without recognized speech, or at 120 seconds. Stop inserts text; Cancel discards only that capture. Dictate again to continue after a pause.

Capture is foreground only; Android `onStop` cancels it. There is no background microphone service, startup listener or wake detector. UI shows microphone preparation, recording timer, processing and microphone-off status.

The words `эй` and `твик` exist in the actual model vocabulary (`224198`, `18523`). This does not establish wake-phrase quality. A future opt-in prototype requires real positive/negative audio, false accepts/hour and recall measurements, noise/battery tests and Android foreground-service lifecycle work. This build does not advertise working wake activation.

## Data and privacy

Dexie schema v3 migrates the old journal and adds structured fields and `journalDrafts`. JSON backup v3 contains completed journal entries but excludes drafts. Import accepts v1/v2/v3, validates journal data before writing and replaces data transactionally. Import v1 retains entries/drafts and repairs their references against the imported planner. Private entry/draft fields are excluded from task share links and ICS calendar export.

All journal text is local plaintext, without additional app encryption. Full JSON backups are readable and must be protected. Preview disables Android system backup (`allowBackup=false`); earlier app builds may permit it. The speech model is in app-private no-backup storage. There is no automatic cross-device synchronization. Calendar/journal synchronization means shared local data, not a cloud account.

## Safe Preview build

`android/build.sh` invokes `build-local.sh`. Requires Node/npm, JDK17+, SDK platform35/build-tools35.0.0, and `npm ci`. Set `JAVA_HOME`, `ANDROID_HOME` and optionally `OPENTWEEK_BUILD_CACHE`, then run `./android/build.sh` from `opentweek`.

The package is `app.opentweek.preview`, label **OpenTweek Preview**, separate from `app.opentweek`. The WebView origin stays `https://app.opentweek.local` but storage/preferences belong to the separate Android sandbox. Preview starts with an empty database and installs alongside the main app. Do not uninstall the main app.

Each build preserves a versioned directory in `android/artifacts/` containing APK, SHA256 and source/version/signing manifest. Signing uses only a disposable debug key in `/tmp`. The repository release keystore is never used. If the temporary key is lost, a new signature cannot update an installed Preview: preserve its data before resolving that mismatch, never uninstall to bypass it. See [PREVIEW.md](../android/PREVIEW.md).

The APK bundles arm64-v8a, armeabi-v7a, x86 and x86_64. minSDK24/targetSDK34. Dependency checksums, Java/D8 compilation, APK identity, v2/v3 signatures and ZIP alignment are verified. Historical builds remain intact.

## Verification and remaining device checks

- `npm test`: migration, structured-only entries, drafts, stable IDs, task/recurrence link lifecycle and Undo, backup validation/rollback, private export separation, deterministic guidance, voice cancellation/duplicate events.
- `npm run test:e2e`: synthetic data and mocked Android bridge; two-mode navigation, rename/move/delete, shared local date near UTC rollover, draft restore/cancel, guided fields, voice review/cancel/permissions/model download, mobile width.
- `npm run lint`, `npm run build`, `./android/test.sh`, `python3 android/verify-preview.py`, APK compile/signature/alignment.
- `.github/workflows/opentweek.yml` runs these remotely and uploads Preview artifacts. Account billing can prevent jobs from starting; local results do not constitute a CI pass.

No real-device microphone or installation was performed. Still test permission allow/deny, Russian recognition accuracy, airplane mode after model installation, screen lock/app switch, calls/Bluetooth, battery and process termination. Use nonpersonal test speech first. No wake prototype has been validated.
