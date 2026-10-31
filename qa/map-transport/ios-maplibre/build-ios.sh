#!/usr/bin/env bash
set -euo pipefail
QA_SDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_SDK_TEAM="${1:-${APPLE_TEAM_ID:-}}"
if [[ ! "$QA_SDK_TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
  echo 'Set APPLE_TEAM_ID or pass the existing signing team as the first argument.' >&2
  exit 2
fi
python3 -B "$QA_SDK_ROOT/prepare-sdk.py"
mkdir -p "$QA_SDK_ROOT/.build"
xcodebuild -project "$QA_SDK_ROOT/MapLibreQA.xcodeproj" \
  -scheme MapLibreQA -configuration Debug -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$QA_SDK_ROOT/.build/DerivedData" \
  -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$QA_SDK_TEAM" \
  build > "$QA_SDK_ROOT/.build/build-private.log" 2>&1
echo 'Standalone MapLibre QA build completed; product app unchanged.'
