#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 6 ]]; then
  echo 'Usage: bash run-test.sh <okhttp.jar> <okio.jar> <kotlin.jar> <mockwebserver.jar> <junit.jar> <hamcrest-core.jar>' >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_host="$qa_root/.."
qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-http2.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
python3 -B "$qa_host/prepare-classpath.py" "$1" "$2" "$3"

qa_verify_jar() {
  if [[ $(shasum -a 256 -- "$1" | cut -d ' ' -f 1) != "$2" ]]; then
    echo "Unexpected HTTP/2 fixture dependency: ${1##*/}" >&2
    exit 1
  fi
}

qa_verify_jar "$4" 6784673687f4ac8f21679b9d4bc7cdb46e1a1ce1be9d3133b36bede59a741561
qa_verify_jar "$5" 8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3
qa_verify_jar "$6" 66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9
qa_classpath="$1:$2:$3:$4:$5:$6"
javac --release 11 -cp "$qa_classpath" -d "$qa_temp" \
  "$qa_host"/Fixture{Body,Budget,BudgetJournal,HttpClient,RequestPolicy,Tls,TlsTest}.java \
  "$qa_root/FixtureHttp2Test.java"
keytool -genkeypair -alias fixture -keyalg EC -groupname secp256r1 -dname 'CN=localhost' \
  -validity 1 -ext 'SAN=IP:127.0.0.1' -storetype PKCS12 -keystore "$qa_temp/loopback.p12" \
  -storepass fixture-only-password -noprompt >/dev/null 2>&1
java -Dtrip.fixture.tlsRoot="$qa_temp" -cp "$qa_temp:$qa_classpath" app.trippainting.maptransportqa.FixtureHttp2Test
