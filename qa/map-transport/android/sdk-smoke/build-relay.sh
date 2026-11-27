#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 3 ]]; then
  echo 'Usage: bash build-relay.sh <Android 36 android.jar> <Android Build Tools 36.0.0 directory> <new relay.jar>' >&2
  exit 2
fi

qa_root=$(cd -- "$(dirname -- "$0")" && pwd)
qa_android_jar="$1"
qa_tools="$2"
qa_output="$3"
if [[ -e "$qa_output" || -L "$qa_output" || ! -d "$(dirname -- "$qa_output")" ]]; then
  echo 'Choose a new relay JAR path in an existing directory.' >&2
  exit 2
fi

qa_temp=$(mktemp -d "${TMPDIR:-/tmp}/trip-map-relay.XXXXXXXX")
trap 'rm -rf -- "$qa_temp"' EXIT
mkdir "$qa_temp/classes"
javac -source 8 -target 8 -bootclasspath "$qa_tools/core-lambda-stubs.jar:$qa_android_jar" \
  -d "$qa_temp/classes" "$qa_root/FixtureLoopbackRelay.java"
jar cf "$qa_temp/compiled.jar" -C "$qa_temp/classes" .
"$qa_tools/d8" --min-api 36 --lib "$qa_android_jar" --output "$qa_temp/relay.jar" "$qa_temp/compiled.jar"
unzip -p "$qa_temp/relay.jar" classes.dex >"$qa_temp/classes.dex"
"$qa_tools/dexdump" "$qa_temp/classes.dex" >"$qa_temp/dexdump.txt"
rg -F "Class descriptor  : 'LFixtureLoopbackRelay;'" "$qa_temp/dexdump.txt"
(set -o noclobber; cat -- "$qa_temp/relay.jar" >"$qa_output")
printf 'Wrote fixture relay: %s\n' "$qa_output"
