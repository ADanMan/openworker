# OpenTweek local journal implementation plan

> Agentic workers: execute scoped independent tasks with tests, then whole-branch review.

Goal: Android local Russian dictation into an editable feelings journal.
Architecture: React journal + Dexie v2; native narrow JSON bridge; Vosk streaming recognizer with temporary PCM only.
Spec: ../specs/2026-10-03-local-journal.md

## Global constraints
No external ASR/LLM requests or fallback. Preserve data, application id and WebView origin. Explicit download/record/save. No real microphone testing or phone installation. No model binary in Git.

## Review focus
Cancellation suppresses stale callbacks; repeated save cannot duplicate entries; permission denial cannot start capture; failed model download cannot mark ready; v1 restore cannot erase journal.

## Tasks
- [x] Storage: failing Vitest tests for v1 migration, stable-id upsert, empty rejection, v2 backup roundtrip, old backup preservation, malformed journal atomic failure; implement types/db/journal/backup; run full Vitest.
- [x] Native: testable record-session/endpointer/cancellation policy; model download with checksum and bounded safe unzip; native status/start/stop/cancel bridge, AudioRecord/Vosk foreground session, lifecycle cleanup; compile Android and run pure Java tests.
- [x] UI: journal list/editor, optional mood, local-only dictation facade with session ids, permission/error/unsupported states, timer/stop/cancel/model setup; unit tests for stale events, denied permission and unsupported platform; browser E2E with fake bridge.
- [x] Build: isolated Java/Android SDK dependencies where required, preserve legacy build path, add reproducible modern JNI APK build and root CI checks; verify APK metadata and signing status.
- [x] Evaluate wake vocabulary with actual model without using microphone. If absent, explicitly unavailable and document follow-up.
- [ ] Run regressions/typecheck/lint/build, independent review, fix issues, commit/push own branch and draft PR. Attach built artifact if successful.
