#!/usr/bin/env bash
# Compatibility entrypoint: local STT requires a modern SDK and JNI dependencies.
# Uses an isolated debug identity; see build-local.sh and docs/44-local-journal.md.
set -euo pipefail
exec "$(dirname "$0")/build-local.sh" "$@"
