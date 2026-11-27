#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 && $# != 5 ]]; then
  echo "Usage: bash run-tests.sh <okhttp-4.12.0.jar> <okio-jvm-3.6.0.jar> <kotlin-stdlib-2.2.21.jar> [maplibre-opengl-13.6.1.aar android.jar]" >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-host.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
qa_classpath="$1:$2:$3"
qa_sources=("$qa_root"/*.java)
qa_tests=("$qa_root"/*Test.java)
if [[ $# == 5 ]]; then
  python3 -B "$qa_root/prepare-classpath.py" "$1" "$2" "$3" "$4" "$qa_temp/maplibre.jar"
  qa_classpath="$qa_classpath:$qa_temp/maplibre.jar:$5"
  qa_sources+=("$qa_root"/sdk-binding/*.java)
  qa_tests+=("$qa_root"/sdk-binding/*Test.java)
else
  python3 -B "$qa_root/prepare-classpath.py" "$1" "$2" "$3"
  qa_sources+=("$qa_root"/sdk-contract/org/maplibre/android/http/*.java)
fi
javac --release 11 -cp "$qa_classpath" -d "$qa_temp" "${qa_sources[@]}"
for qa_identity in loopback localhost; do
  qa_san='DNS:localhost'
  if [[ $qa_identity == loopback ]]; then qa_san='DNS:localhost,IP:127.0.0.1'; fi
  keytool -genkeypair -alias fixture -keyalg EC -groupname secp256r1 \
    -dname 'CN=localhost' -validity 1 -ext "SAN=$qa_san" -storetype PKCS12 \
    -keystore "$qa_temp/$qa_identity.p12" -storepass fixture-only-password -noprompt >/dev/null 2>&1
done
for qa_test in "${qa_tests[@]}"; do
  qa_name=${qa_test##*/}
  java -Dtrip.fixture.tlsRoot="$qa_temp" -cp "$qa_temp:$qa_classpath" "app.trippainting.maptransportqa.${qa_name%.java}"
done
