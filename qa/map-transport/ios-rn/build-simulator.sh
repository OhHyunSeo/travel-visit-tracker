#!/usr/bin/env bash
set -euo pipefail
qa_dir="$(cd "$(dirname "$0")" && pwd)"
exec bash "$qa_dir/build-ios.sh" iphonesimulator "$@"
