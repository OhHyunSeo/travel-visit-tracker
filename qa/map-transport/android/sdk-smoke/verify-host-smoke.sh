#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 9 ]]; then
  echo 'Usage: bash verify-host-smoke.sh <fixture.apk> <APK SHA-256> <fixture.p12> <build-tools directory> <okhttp.jar> <okio.jar> <kotlin.jar> <MapLibre AAR> <android.jar>' >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_transport="$qa_root/../host-transport"
qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-host-smoke.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
qa_temp=$(cd -- "$qa_temp" && pwd -P)
mkdir "$qa_temp/classes" "$qa_temp/journal"
bash "$qa_root/verify-runtime-inputs.sh" "$1" "$2" "$3" "$4"
qa_port=$(unzip -p "$1" assets/fixture-port)
unzip -p "$1" assets/fixture.der >"$qa_temp/fixture.der"
python3 -B "$qa_transport/prepare-classpath.py" "$5" "$6" "$7" "$8" "$qa_temp/maplibre.jar"
qa_classpath="$qa_temp/classes:$qa_temp/maplibre.jar:$5:$6:$7:$9"
javac --release 11 -cp "$qa_classpath" -d "$qa_temp/classes" \
  "$qa_transport"/Fixture{Body,Budget,BudgetJournal,HttpClient,MapLibreRequest,RequestPolicy,Tls}.java \
  "$qa_transport/sdk-binding/FixtureModuleProvider.java" \
  "$qa_root"/Fixture{LoopbackRelay,StyleServer,SdkSmokeTest,SdkStyleProbe}.java
java -cp "$qa_classpath" FixtureSdkSmokeTest "$3" "$qa_temp/fixture.der" "$qa_temp/journal" "$qa_port" >"$qa_temp/run.log"
cat "$qa_temp/run.log"
test "$(rg -c '^SERVED_STYLE bytes=124$' "$qa_temp/run.log")" = 1
if rg -q '^REJECTED_STYLE ' "$qa_temp/run.log"; then exit 1; fi
PYTHONPATH="$qa_root" python3 -B - "$qa_temp/journal/budget.journal" <<'PY'
from pathlib import Path
import sys
from verify_device_capture import check_journal

journal = Path(sys.argv[1])
check_journal(journal)
print(f'Host SDK journal verified: {journal.stat().st_size} bytes and one style reservation')
PY
