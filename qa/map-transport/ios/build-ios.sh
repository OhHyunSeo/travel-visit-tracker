#!/usr/bin/env bash
set -euo pipefail

QA_IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_TEAM_ID="${1:-${APPLE_TEAM_ID:-}}"
if [[ -z "$QA_TEAM_ID" ]]; then
  echo 'Set APPLE_TEAM_ID or pass the signing team ID as the first argument.' >&2
  exit 2
fi
if [[ ! "$QA_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo 'The signing team ID must contain 10 uppercase letters or digits.' >&2
  exit 2
fi
for QA_SOURCE in main.m TPTransport.m TPTransport.h; do
  if [[ ! -f "$QA_IOS_ROOT/$QA_SOURCE" ]]; then
    echo "Missing QA source: $QA_SOURCE" >&2
    exit 2
  fi
done

mkdir -p "$QA_IOS_ROOT/.build"
QA_BUILD_LOG="$QA_IOS_ROOT/.build/build.log"
if xcodebuild \
  -project "$QA_IOS_ROOT/MapTransportQA.xcodeproj" \
  -scheme MapTransportQA \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$QA_IOS_ROOT/.build/DerivedData" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$QA_TEAM_ID" \
  build > "$QA_BUILD_LOG" 2>&1; then
  printf 'Build succeeded. App: %s\n' "$QA_IOS_ROOT/.build/DerivedData/Build/Products/Debug-iphoneos/MapTransportQA.app"
else
  QA_BUILD_EXIT=$?
  echo 'Build failed. Private signing diagnostics are in ios/.build/build.log.' >&2
  exit "$QA_BUILD_EXIT"
fi
