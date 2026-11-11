#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 && $# != 5 ]]; then
  echo "Usage: bash run-tests.sh <okhttp-4.12.0.jar> <okio-jvm-3.6.0.jar> <kotlin-stdlib-2.2.21.jar> [maplibre-opengl-13.6.1.aar android.jar]" >&2
  exit 2
fi

python3 -B - "$1" "$2" "$3" <<'PY'
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
qa_sources=("$qa_root"/*.java)
qa_tests=("$qa_root"/*Test.java)
if [[ $# == 5 ]]; then
  python3 -B - "$4" "$qa_temp/maplibre.jar" <<'PY'
import hashlib
from pathlib import Path
import sys
import zipfile

archive = Path(sys.argv[1])
if archive.stat().st_size != 15_598_638 or hashlib.sha256(archive.read_bytes()).hexdigest() != '0a8ea4f5bfd268e050c72025d0f2952b60861863eba6caf84e19b8da583f3a42':
    raise SystemExit('Unexpected MapLibre OpenGL 13.6.1 AAR')
with zipfile.ZipFile(archive) as source:
    classes = source.read('classes.jar')
if hashlib.sha256(classes).hexdigest() != 'ac36e99396ebb01ff781e090c7b9b1557b4d1ccecac653ef511c775a3570136b':
    raise SystemExit('Unexpected MapLibre classes.jar')
Path(sys.argv[2]).write_bytes(classes)
PY
  qa_classpath="$qa_classpath:$qa_temp/maplibre.jar:$5"
  qa_sources+=("$qa_root"/sdk-binding/*.java)
  qa_tests+=("$qa_root"/sdk-binding/*Test.java)
else
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
