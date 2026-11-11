#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 ]]; then
  echo "Usage: bash run-tests.sh <okhttp-4.12.0.jar> <okio-jvm-3.6.0.jar> <kotlin-stdlib-2.2.21.jar>" >&2
  exit 2
fi

python3 -B - "$@" <<'PY'
import hashlib
from pathlib import Path
import sys

expected = (
    'b1050081b14bb7a3a7e55a4d3ef01b5dcfabc453b4573a4fc019767191d5f4e0',
    '67543f0736fc422ae927ed0e504b98bc5e269fda0d3500579337cb713da28412',
    '6558a3d233da56a20934b32159f9db5f86ed5816ef098f78a2c223dc6abb79dd',
)
for filename, digest in zip(sys.argv[1:], expected):
    if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Unexpected host test dependency: {Path(filename).name}')
PY

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-host.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
qa_classpath="$1:$2:$3"
javac --release 11 -cp "$qa_classpath" -d "$qa_temp" "$qa_root"/*.java \
  "$qa_root"/sdk-contract/org/maplibre/android/http/*.java
for qa_test in "$qa_root"/*Test.java; do
  qa_name=${qa_test##*/}
  java -cp "$qa_temp:$qa_classpath" "app.trippainting.maptransportqa.${qa_name%.java}"
done
