# Preview 1.5.0: explicitly enabled cross-app diary window

Android 26+ can optionally keep the existing local Vosk recognizer running after the user leaves OpenTweek. An exact experimental «эй, Твик» match opens a small, branded `TYPE_APPLICATION_OVERLAY` diary window over the current app. The user finishes dictation, reviews its text/date, and explicitly saves a new diary entry or cancels that capture. Waiting resumes after either action until the original one-hour deadline. Every new session requires fresh consent inside the visible application.

## Activation and stopping

1. Update the existing `app.opentweek.preview` installation using the same Preview signing identity; do not uninstall it.
2. Download the existing Russian model from the diary if necessary. Its download is separate from microphone activation.
3. Open “«Эй, Твик» из других приложений”, read the microphone/battery/window explanation, and use the settings button to grant “Display over other apps” manually. Returning from Settings does not start listening.
4. Check the session consent and press “Включить на 1 час”. Microphone and notification permissions must also be granted. Double clicks cannot create multiple starts; Stop can cancel permission-pending startup.
5. Leave the app, say the phrase, wait for the recording indicator/window, then dictate. Finish is not Save. Review and Save are required to create an entry.
6. The ongoing notification, application panel, and window header each provide Stop for the whole session. Window Cancel discards only that capture and resumes waiting. After a committed save, Close closes the saved result without deleting it.

Screen-off/lock, expiry, revoked overlay/notification access, microphone or model failure terminate the whole session. It is `START_NOT_STICKY`, has no boot receiver, and never silently enables itself after force-stop, process death, or reboot. A user must restart from the visible app. Continuous microphone use consumes battery; no measured battery estimate is available.

## Native and data boundaries

- `WakeOverlaySession` owns the original deadline and waits for both native recognizer release and review acknowledgement before a new capture. Acknowledgement may arrive before or after release.
- `LocalWakeService` reuses its already-running microphone foreground service between captures. Startup and the periodic guard require app notifications, Android 13+ notification permission, and a non-disabled microphone notification channel. Locked-screen or invisible-overlay permission states stop the mode.
- `WakeOverlayWindow` loads packaged `overlay.html` from the same origin as the existing diary so IndexedDB remains the single diary store. Its narrow bridge exposes status, Finish, Cancel, Stop, and save acknowledgement only. External requests/navigation and file/content access are blocked. `FLAG_SECURE` protects the popup from ordinary screenshots; no attempt is made to unlock the phone.
- PCM audio remains in bounded memory only. No external speech API, audio upload, microphone settings change, or added model dependency is introduced. The existing dual exact phrase gate is preserved; it is not a certified wake-word detector.
- Pending text is durably kept in app-private native preferences until acknowledgement. A confirmed popup save and the `wake-insert:<capture UUID>` receipt share one IndexedDB transaction. Replays, main-editor insertion, or lost acknowledgement cannot create a duplicate entry or replace an unrelated imported ID.
- Once the database commits, the popup freezes text/date and offers acknowledgement-only retry. Reopening reads the receipt and current saved entry. Existing entry/draft fields and schema are preserved. Stopping during review retains pending text for explicit review in the main diary.

## Verification and phone acceptance

Local verification: 113 unit tests, 29 browser E2E scenarios, TypeScript, lint (one pre-existing `TaskModal` warning), six native test groups, APK compilation/packaging/signature checks, and independent read-only code review. Browser tests use mocked native bridges; they cover consent, denied permission, mode switches, pending Stop, no automatic saving, cancellation, storage failures, receipts, failed acknowledgement, reload, and duplicate prevention. They do not emulate Android overlay permission or microphone hardware.

On the actual phone, still verify: manually grant/deny/revoke each permission; popup and keyboard in another unlocked app; repeated Save/Cancel cycles; screen-off/lock; notification-channel disable; microphone competition; force-stop/reboot/manual restart; expiry; existing diary entries/drafts after update. Test the Russian phrase with the user's real microphone, accent, room noise, and negative phrases. Prior synthetic checks do not establish physical-phone recognition quality. Some applications can hide overlays; background restrictions or the OS may end the session. Web/browser and desktop do not receive this Android-only window.

Android references: [microphone foreground-service and background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [explicit overlay permission](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)), and [background activity-start limits](https://developer.android.com/guide/components/activities/secure-bal). This implementation starts its service from the visible app and uses an overlay rather than forcing a background Activity open.
