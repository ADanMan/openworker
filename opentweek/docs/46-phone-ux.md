# Preview 1.4.1: phone writing flow and microphone diagnostics

The supplied phone recording showed the current journal UI entering wake waiting for roughly 45 seconds without a transition to dictation. A later manual capture entered recording and processing, then returned `no_speech`. The voice information occupied most of the visible editor. The header calendar microphone was still exposed in journal mode and displayed an unrelated-editor message when tapped. No private audio, journal contents, screenshots, or video are included in the repository.

Changes:

- One Calendar/Journal mode selector; the calendar task microphone is shown only in Calendar.
- On mobile the editor precedes the list of entries; the shared date remains available in both modes.
- Optional guidance shows one field at a time with Back, Skip, and Next. All seven existing fields remain stored, including skipped or hidden fields. Selecting a field does not erase its value. Guidance, field and destination controls are disabled while capture/insertion is busy.
- Concise voice instructions and collapsed detailed privacy/limitations. The Save action is sticky within the editor, rather than fixed over the whole application.
- Own-recorder Android 29+ silencing status is checked, with null treated as unknown. Microphone unavailable/read/disconnection, permission, and foreground-service failures have distinct non-sensitive error codes and actionable messages.
- Foreground microphone notifications identify model loading, phrase waiting, dictation, or processing while preserving the Stop action.

Storage schema, draft queue, entry migration, recovery insertion receipts, Preview package identity, local Vosk model, and dual exact phrase gate are unchanged. No external speech service or audio persistence was introduced.

The video does not prove the cause of failed recognition. Screen recording can compete for microphone input, but this update reports silencing only when Android reports it for this recorder. The experimental phrase still needs physical-phone testing and can reject valid speech. Browser E2E tests use a native bridge mock; reduced viewport tests simulate available space and do not verify the actual Android keyboard. Native tests and APK compilation do not verify microphone quality on a Pixel.
