#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 6 ]]; then
  echo 'Usage: bash verify-android-sources.sh <okhttp.jar> <okio.jar> <kotlin.jar> <MapLibre AAR> <Android 36 android.jar> <Android build-tools 36.0.0 directory>' >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_transport="$qa_root/../host-transport"
qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-sdk-api-check.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
mkdir "$qa_temp/classes" "$qa_temp/dex"

python3 -B "$qa_transport/prepare-classpath.py" "$1" "$2" "$3" "$4" "$qa_temp/maplibre.jar"
qa_classpath="$qa_temp/maplibre.jar:$1:$2:$3"
javac -source 8 -target 8 -bootclasspath "$6/core-lambda-stubs.jar:$5" -cp "$qa_classpath" \
  -d "$qa_temp/classes" "$qa_transport"/Fixture{Body,Budget,BudgetJournal,HttpClient,MapLibreRequest,RequestPolicy,Tls}.java \
  "$qa_transport/sdk-binding/FixtureModuleProvider.java" \
  "$qa_root"/src/main/java/app/trippainting/maptransportqa/*.java
jar cf "$qa_temp/application.jar" -C "$qa_temp/classes" .
"$6/d8" --min-api 36 --lib "$5" --classpath "$qa_temp/maplibre.jar" --classpath "$1" --classpath "$2" --classpath "$3" \
  --output "$qa_temp/dex" "$qa_temp/application.jar"
"$6/dexdump" "$qa_temp/dex/classes.dex" >"$qa_temp/dexdump.txt"
for qa_class in FixtureApplication FixtureMapActivity FixtureModuleProvider; do
  rg -F "Class descriptor  : 'Lapp/trippainting/maptransportqa/$qa_class;'" "$qa_temp/dexdump.txt"
done
echo 'Android 36 Java and DEX source check passed.'
