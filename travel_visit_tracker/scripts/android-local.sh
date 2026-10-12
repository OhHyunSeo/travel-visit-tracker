#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd -- "$script_dir/.." && pwd)"
sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
emulator_serial="${ANDROID_SERIAL:-emulator-5554}"
adb_path="$sdk_root/platform-tools/adb"

if [[ "$emulator_serial" != emulator-* ]]; then
  echo '이 명령은 Android Studio 에뮬레이터 전용입니다.' >&2
  exit 1
fi
if [[ ! -x "$adb_path" ]] || [[ "$("$adb_path" -s "$emulator_serial" get-state 2>/dev/null)" != device ]]; then
  echo 'Android Studio에서 에뮬레이터를 먼저 실행해 주세요.' >&2
  exit 1
fi

"$adb_path" -s "$emulator_serial" reverse tcp:8081 tcp:8081
cd "$app_root"
export PATH="$app_root/../.tooling/node_modules/.bin:$PATH"
export EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 NODE_OPTIONS=--dns-result-order=ipv4first

if [[ "$(curl --silent --max-time 2 http://127.0.0.1:8081/status || true)" == packager-status:running ]]; then
  echo '실행 중인 Metro에 Android 에뮬레이터를 연결합니다.'
  "$adb_path" -s "$emulator_serial" shell am start -a android.intent.action.VIEW \
    -d 'trippainting://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' \
    app.trippainting.mobile
else
  echo 'localhost:8081에서 Metro를 시작합니다. 앱의 개발 서버 주소는 http://127.0.0.1:8081 입니다.'
  exec npx expo start --dev-client --localhost --port 8081
fi
