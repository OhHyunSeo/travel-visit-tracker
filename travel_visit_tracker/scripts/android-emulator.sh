#!/usr/bin/env bash
set -euo pipefail

sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
emulator_path="$sdk_root/emulator/emulator"
adb_path="$sdk_root/platform-tools/adb"
avd_name="${ANDROID_AVD:-Medium_Phone_API_37.0}"
gpu_mode="${ANDROID_GPU_MODE:-swiftshader}"

if [[ ! -x "$emulator_path" || ! -x "$adb_path" ]]; then
  echo '설치된 Android SDK의 emulator와 adb가 필요합니다.' >&2
  exit 1
fi
case "$gpu_mode" in
  auto|host|software|lavapipe|swiftshader|swangle) ;;
  *) echo '설치 도구의 -help-gpu에서 지원하는 GPU 모드를 지정해 주세요.' >&2; exit 1 ;;
esac
gpu_help="$("$emulator_path" -help-gpu)"
if ! printf '%s\n' "$gpu_help" | grep -Eq "^[[:space:]]+$gpu_mode[[:space:]]"; then
  echo '이 Emulator 버전은 선택한 GPU 모드를 지원하지 않습니다.' >&2
  exit 1
fi
if ! "$emulator_path" -list-avds | grep -Fxq "$avd_name"; then
  echo '기존 AVD를 찾을 수 없습니다. 새 이미지나 AVD는 자동 설치하지 않습니다.' >&2
  exit 1
fi
if "$adb_path" devices | grep -Eq '^emulator-[0-9]+[[:space:]]'; then
  echo '실행 중인 에뮬레이터가 있습니다. 기존 시험 상태를 먼저 확인해 주세요.' >&2
  exit 1
fi
echo "AVD $avd_name, CPU 4개, GPU $gpu_mode. 기존 데이터와 스냅샷을 보존합니다."
exec "$emulator_path" -avd "$avd_name" -port 5554 -no-snapshot -no-boot-anim \
  -cores 4 -gpu "$gpu_mode" -no-window -grpc-use-token
