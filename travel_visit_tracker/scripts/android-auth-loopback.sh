#!/usr/bin/env bash
set -euo pipefail

# Use only after the common auth source and an isolated synthetic server are ready.
sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
adb_path="$sdk_root/platform-tools/adb"
serial="${ANDROID_SERIAL:-emulator-5554}"
auth_port="${ANDROID_AUTH_PORT:-3002}"
action="${1:-connect}"

if [[ "$action" == --help ]]; then
  echo '합성 계정용 localhost 서버의 /health를 확인한 뒤 emulator 포트를 연결합니다.'
  echo '기본 포트 3002. ANDROID_AUTH_PORT로 변경하며 --remove로 해당 연결만 제거합니다.'
  exit 0
fi
if [[ "$action" != connect && "$action" != --remove ]]; then
  echo '지원하는 동작: connect, --remove, --help' >&2
  exit 1
fi
if [[ ! "$auth_port" =~ ^[1-9][0-9]{3,4}$ ]] || (( auth_port < 1024 || auth_port > 65535 )); then
  echo '테스트 서버 포트를 1024~65535로 지정해 주세요.' >&2
  exit 1
fi
case "$auth_port" in
  3000|3001|8081|8082)
    echo '공통 서버·Metro 포트는 인증 테스트 연결에 사용하지 않습니다.' >&2
    exit 1 ;;
esac
if [[ "$serial" != emulator-* || ! -x "$adb_path" ]]; then
  echo '이 도구는 설치된 Android SDK의 에뮬레이터 전용입니다.' >&2
  exit 1
fi
if [[ "$("$adb_path" -s "$serial" get-state 2>/dev/null)" != device ]] ||
   [[ "$("$adb_path" -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]]; then
  echo '검증용 에뮬레이터가 연결되어 있어야 합니다.' >&2
  exit 1
fi
if [[ "$action" == --remove ]]; then
  "$adb_path" -s "$serial" reverse --remove "tcp:$auth_port"
  echo "인증 시험의 tcp:$auth_port 연결만 제거했습니다."
  exit 0
fi
if ! curl --fail --silent --max-time 2 --output /dev/null "http://127.0.0.1:$auth_port/health"; then
  echo '먼저 해당 포트에 임시 DB·합성 계정 전용 루프백 서버를 준비해 주세요.' >&2
  exit 1
fi
"$adb_path" -s "$serial" reverse "tcp:$auth_port" "tcp:$auth_port"
echo "합성 시험용 API 주소: http://127.0.0.1:$auth_port"
echo '앱 실행·로그인·게스트 가져오기는 이 도구가 수행하지 않습니다.'
