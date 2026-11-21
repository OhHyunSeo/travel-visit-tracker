#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 5 ]]; then
  echo 'Usage: bash build-apk.sh <Gradle executable> <Android SDK> <fixture.der> <port> <new APK path>' >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_transport="$qa_root/../host-transport"
qa_cache="$qa_root/../.build/sdk-smoke-gradle"
qa_sdk=$(cd -- "$2" && pwd)
qa_tools="$qa_sdk/build-tools/36.0.0"
qa_gradle="$1"
qa_port="$4"
qa_output="$5"
if [[ "$qa_gradle" != /* || ! -x "$qa_gradle" || ! -r "$qa_sdk/platforms/android-36/android.jar" || ! -x "$qa_tools/aapt2" ]]; then
  echo 'Use an absolute Gradle executable path and an installed Android 36 SDK and Build Tools 36.0.0.' >&2
  exit 2
fi
if [[ ! "$qa_port" =~ ^[1-9][0-9]{3,4}$ ]] || (( qa_port < 1024 || qa_port > 65535 )); then
  echo 'Fixture port must be between 1024 and 65535.' >&2
  exit 2
fi
if [[ -e "$qa_output" || -L "$qa_output" || ! -d "$(dirname -- "$qa_output")" ]]; then
  echo 'Choose a new APK path in an existing directory.' >&2
  exit 2
fi
keytool -printcert -file "$3" >/dev/null

mkdir -p -- "$qa_cache"
qa_stage=$(mktemp -d "$qa_root/../.build/sdk-smoke.XXXXXXXX")
trap 'rm -rf -- "$qa_stage"' EXIT
qa_sources="$qa_stage/src/main/java/app/trippainting/maptransportqa"
qa_assets="$qa_stage/src/main/assets"
mkdir -p -- "$qa_sources" "$qa_assets" "$qa_stage/android-home"
cp -- "$qa_root"/{settings.gradle,gradle.properties,build.gradle} "$qa_stage/"
cp -- "$qa_root/src/main/AndroidManifest.xml" "$qa_stage/src/main/"
cp -- "$qa_root"/src/main/java/app/trippainting/maptransportqa/*.java "$qa_sources/"
cp -- "$qa_transport"/Fixture{Body,Budget,BudgetJournal,HttpClient,MapLibreRequest,RequestPolicy,Tls}.java \
  "$qa_transport/sdk-binding/FixtureModuleProvider.java" "$qa_sources/"
cp -- "$3" "$qa_assets/fixture.der"
printf '%s' "$qa_port" >"$qa_assets/fixture-port"
keytool -genkeypair -keystore "$qa_stage/fixture-debug.keystore" -alias androiddebugkey \
  -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 30 \
  -dname 'CN=Trip Painting Android fixture' -noprompt >/dev/null 2>&1

ANDROID_HOME="$qa_sdk" ANDROID_SDK_ROOT="$qa_sdk" ANDROID_USER_HOME="$qa_stage/android-home" \
  "$qa_gradle" --project-dir "$qa_stage" --gradle-user-home "$qa_cache" \
  --no-daemon --no-build-cache --max-workers=2 --console=plain assembleDebug

qa_apk="$qa_stage/build/outputs/apk/debug/map-transport-fixture-debug.apk"
"$qa_tools/apksigner" verify --min-sdk-version 36 "$qa_apk"
"$qa_tools/zipalign" -c -P 16 4 "$qa_apk"
"$qa_tools/aapt2" dump badging "$qa_apk" >"$qa_stage/badging.txt"
rg -F "package: name='app.trippainting.maptransportqa.sdk'" "$qa_stage/badging.txt"
rg -F "native-code: 'arm64-v8a'" "$qa_stage/badging.txt"
"$qa_tools/aapt2" dump permissions "$qa_apk" >"$qa_stage/permissions.txt"
sed -n "s/^uses-permission: name='\([^']*\)'.*$/\1/p" "$qa_stage/permissions.txt" | LC_ALL=C sort >"$qa_stage/uses-permissions.txt"
diff -u "$qa_stage/uses-permissions.txt" - <<'EOF'
android.permission.ACCESS_NETWORK_STATE
android.permission.ACCESS_WIFI_STATE
android.permission.INTERNET
app.trippainting.maptransportqa.sdk.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
EOF
"$qa_tools/aapt2" dump xmltree "$qa_apk" --file AndroidManifest.xml >"$qa_stage/manifest.txt"
rg -q ':allowBackup\(0x[0-9a-f]+\)=false$' "$qa_stage/manifest.txt"
rg -q ':usesCleartextTraffic\(0x[0-9a-f]+\)=false$' "$qa_stage/manifest.txt"
rg -q ':name\(0x[0-9a-f]+\)="app\.trippainting\.maptransportqa\.FixtureApplication"' "$qa_stage/manifest.txt"
rg -q ':name\(0x[0-9a-f]+\)="app\.trippainting\.maptransportqa\.FixtureMapActivity"' "$qa_stage/manifest.txt"
unzip -p "$qa_apk" lib/arm64-v8a/libmaplibre.so | shasum -a 256 | \
  rg -q '^d3a1ab9b9d056d84b93f2aa5f676d20d2d76723952dfcd8bd8d203d6eca6980d  -$'
unzip -p "$qa_apk" assets/fixture.der | cmp - "$qa_assets/fixture.der"
unzip -p "$qa_apk" assets/fixture-port | cmp - "$qa_assets/fixture-port"
(set -o noclobber; cat -- "$qa_apk" >"$qa_output")
printf 'Wrote signed fixture APK: %s\n' "$qa_output"
