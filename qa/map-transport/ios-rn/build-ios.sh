#!/usr/bin/env bash
set -euo pipefail
qa_dir="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$qa_dir/../../.." && pwd)"
sdk="${1:?Choose iphonesimulator or iphoneos}"
stage_name="${2:?New staging directory name required}"
case "$sdk" in
  iphonesimulator)
    destination='generic/platform=iOS Simulator'
    signing=(CODE_SIGNING_ALLOWED=NO)
    ;;
  iphoneos)
    destination='generic/platform=iOS'
    team="${APPLE_TEAM_ID:?Set APPLE_TEAM_ID for the isolated QA app}"
    [[ "$team" =~ ^[A-Z0-9]{10}$ ]]
    signing=(-allowProvisioningUpdates CODE_SIGN_STYLE=Automatic "DEVELOPMENT_TEAM=$team")
    ;;
  *) exit 2 ;;
esac
export TP_RN_NODE="${TP_RN_NODE:-$repo/.tooling/node_modules/.bin/node}"
export PATH="$(dirname "$TP_RN_NODE"):$PATH"
[[ "$("$TP_RN_NODE" --version)" == v24.21.0 ]]
export CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1

stage_dir="$(python3 -B "$qa_dir/stage.py" "$stage_name" --sdk "$sdk")"
"${TP_RN_RUBY:-ruby}" "$qa_dir/configure-project.rb" "$stage_dir/ios"
cd "$stage_dir"
"$TP_RN_NODE" node_modules/expo/bin/cli export:embed --platform ios --dev false \
  --entry-file index.js --bundle-output ios/TripPainting/main.jsbundle --assets-dest "$stage_dir/bundle-assets"
xcodebuild -workspace ios/TripPainting.xcworkspace -scheme TripPainting -configuration Debug \
  -sdk "$sdk" -destination "$destination" -jobs 4 \
  -derivedDataPath "$stage_dir/DerivedData" -clonedSourcePackagesDirPath "$stage_dir/SourcePackages" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile -skipPackageUpdates \
  "${signing[@]}" build
