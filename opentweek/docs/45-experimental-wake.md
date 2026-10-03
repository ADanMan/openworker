# Experimental local wake phrase — Preview 1.4.0

## Conditions and controls

In the journal's Russian dictation section, expand **Эксперимент: «эй, Твик»**, explicitly consent for the session, then tap **Ждать фразу**. The installed Russian model, microphone permission and visible notification permission/channel are required. The control defaults off every time; it never starts at boot or from a launcher intent.

A microphone foreground service owns the recognizer and AudioRecord using application context. It can continue after switching to another app or Activity destruction. Activity observation is weak; recreating the editor reads the existing service session, without starting a new microphone. Start is initiated while the Activity is visible, consistent with Android's while-in-use microphone restrictions. See [Android foreground service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) and [required service types](https://developer.android.com/about/versions/14/changes/fgs-types-required).

Waiting and recording are distinct states. Say the phrase, pause, then begin dictation after the Recording indicator appears. Both local decoders must return finalized exact `эй твик`; the first uses a constrained grammar with `[unk]`, the second verifies only candidate PCM (at most five seconds) with an unrestricted recognizer. The wake phrase is not inserted into the dictated text. Model and PCM stay local; candidate buffers are reset/wiped, never written to an audio file.

Waiting stops after five minutes. After activation, recording keeps the existing maximum two minutes and speech/empty-room endpoints. A result ends the service; there is no automatic rearm. Stop in the ongoing notification, Stop waiting, cancelling dictation or closing/changing the editor ends the session. Switching to another app retains the service. Force-stop, process termination and reboot end listening; `START_NOT_STICKY` and no boot restart mean manual re-enabling is required. Screen-lock/OEM power management behavior is not verified on a device.

No background Activity is launched automatically. A completed nonempty transcript is first durably saved in Preview-private preferences, then a separate notification offers opening the journal. The user checks the date and destination field and explicitly inserts or discards. Unreviewed results block another wake start. Empty recordings return `no_speech` without creating a pending result.

Insertion of text and a session receipt into IndexedDB share one transaction. Repeating insertion after failed native acknowledgement or process recreation never duplicates the text or overwrites newer unsaved changes. Acknowledgement returns success only after matched durable preference removal. Old session stops/results cannot operate on a new session. The service and result live in the Preview sandbox; the main app is separate.

The result remains local plaintext until reviewed/discarded. Preview system backup is disabled. Private pending voice results and receipt metadata are excluded from calendar ICS/share and full JSON backup; completed entries keep the previous explicit backup behavior.

## Checked without a phone

- Java gate: exact finalized dual match, close negative phrases, partial rejection, duplicate/cancel/timeout; bounded PCM ring order/reset.
- Android source/service policy and complete javac/D8 APK build, microphone service manifest permissions, notification Stop and `START_NOT_STICKY`.
- TypeScript controller: waiting vs recording, explicit opt-in, permission failure, timeout, stale callback rejection, no rearm, service restoration and no automatic insertion.
- Transaction tests: rollback, retries, recovery across recreation/finalization, field capacity and replay preserving unsaved edits.
- Browser with a fake Android bridge: opt-in, waiting/cancel/mode switch, restored service Stop, explicit private result insertion and failed acknowledgement replay. These do not execute Android lifecycle or microphone APIs.
- Actual local Vosk model on synthetic Milena speech: 2 of 3 positive clips accepted (rates 100/180), fast rate260 rejected; all 8 negative fixtures rejected, including `эй ты`, `эй Вик`, `эй Твикер`, bare words, unrelated speech, silence and seeded noise. The one-stage constrained decoder falsely accepted the three close negatives; the second stage rejected them. [Exact synthetic report](validation/1.4.0-synthetic-wake.json).

This small single-voice synthetic test does not measure production recall or false accepts per hour. Fast speech can be missed; different speakers/noise can still cause false activation.

## Minimal next device check

A real Android phone is needed to confirm notification/Stop, microphone permission denial, switching apps, screen lock, force-stop/reboot and OEM power behavior. Use nonpersonal speech: say `эй, Твик`, pause, then one short sentence, check the private review and save. Repeat once after switching apps, then Stop from the notification and verify that the system microphone indicator turns off.

To tune phrase recognition without using the phone microphone remotely, the minimum useful optional input is three local recordings of the user's phrase (normal/slow/fast) plus three similar negative phrases, 16 kHz mono PCM if available, and the phone model/Android version. These are for local validation only, never public fixtures. No such recordings or device access were used to build this version.
