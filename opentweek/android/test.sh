#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if test -n "${JAVA_HOME:-}"; then export PATH="$JAVA_HOME/bin:$PATH"; fi
OUT=$(mktemp -d "${TMPDIR:-/tmp}/opentweek-java-tests.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
javac --release 8 -d "$OUT" src/app/opentweek/LocalVoiceModel.java test/app/opentweek/LocalVoiceModelTest.java
java -cp "$OUT" app.opentweek.LocalVoiceModelTest
javac --release 8 -d "$OUT" src/app/opentweek/WakePhrase.java test/app/opentweek/WakePhraseTest.java
java -cp "$OUT" app.opentweek.WakePhraseTest
javac --release 8 -d "$OUT" src/app/opentweek/WakeAudioBuffer.java test/app/opentweek/WakeAudioBufferTest.java
java -cp "$OUT" app.opentweek.WakeAudioBufferTest
python3 test/wake-policy.py
