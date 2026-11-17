#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 3 || ! "$1" =~ ^[a-f0-9]{40}$ || ! "$3" =~ ^[1-9][0-9]{3,4}$ ]] || (( $3 < 1024 || $3 > 65535 )); then
  echo 'Usage: bash stage.sh <product commit SHA> <public fixture DER> <fixture port>' >&2
  exit 2
fi
test "$(node --version)" = v24.21.0
qa=$(cd -- "$(dirname -- "$0")" && pwd)
repo=$(git -C "$qa" rev-parse --show-toplevel)
product="$repo/travel_visit_tracker"
keytool -printcert -file "$2" >/dev/null
git -C "$repo" show "$1:travel_visit_tracker/package-lock.json" | cmp - "$product/package-lock.json"

mkdir -p "$qa/../.build"
stage=$(mktemp -d "$qa/../.build/rn-recovery.XXXXXXXX")
app="$stage/android/app"
sources="$app/src/main/java/app/trippainting/maptransportqa"
assets="$app/src/main/assets"
mkdir -p "$sources" "$assets" "$stage/product-source" "$stage/android-user" "$stage/gradle-home"
git -C "$repo" archive "$1:travel_visit_tracker/src" | tar -xf - -C "$stage/product-source"
cp -cR -P "$product/node_modules" "$stage/node_modules"
node - "$product/package.json" "$stage/package.json" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const { dependencies } = JSON.parse(fs.readFileSync(process.argv[2]));
const modules = ['expo', 'expo-asset', 'expo-constants', 'expo-file-system', 'expo-sqlite',
  'react', 'react-native', '@maplibre/maplibre-react-native'];
const result = Object.fromEntries(modules.map((name) => {
  const version = dependencies[name] ?? require(path.join(path.dirname(process.argv[2]), 'node_modules', name, 'package.json')).version;
  return [name, version];
}));
fs.writeFileSync(process.argv[3], JSON.stringify({ name: 'trip-map-rn-recovery', version: '1.0.0',
  private: true, main: 'index.js', dependencies: result }));
JS
cp "$qa/index.js" "$stage/index.js"
printf '%s\n' 'module.exports = { presets: ["babel-preset-expo"] };' > "$stage/babel.config.js"
printf '%s\n' 'module.exports = require("expo/metro-config").getDefaultConfig(__dirname);' > "$stage/metro.config.js"
cp "$qa/settings.gradle" "$stage/android/settings.gradle"
cp "$qa/root.gradle" "$stage/android/build.gradle"
cp "$qa/app.gradle" "$app/build.gradle"
cp "$qa/AndroidManifest.xml" "$app/src/main/AndroidManifest.xml"
cat > "$stage/android/gradle.properties" <<'EOF'
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m
android.useAndroidX=true
android.compileSdkVersion=36
android.targetSdkVersion=36
newArchEnabled=true
hermesEnabled=true
reactNativeArchitectures=arm64-v8a
EOF
cp "$qa"/*.kt "$sources/"
cp "$qa/../host-transport"/Fixture{Body,Budget,BudgetJournal,HttpClient,MapLibreRequest,RequestPolicy,Tls}.java \
  "$qa/../host-transport/sdk-binding/FixtureModuleProvider.java" "$sources/"
cp -- "$2" "$assets/fixture.der"
printf '%s' "$3" > "$assets/fixture-port"
printf '%s\n' "$1" > "$assets/product-source-commit"
keytool -genkeypair -keystore "$app/fixture-debug.keystore" -alias androiddebugkey \
  -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 30 \
  -dname 'CN=Trip Painting RN recovery fixture' -noprompt >/dev/null 2>&1
cd -- "$stage"
pwd
