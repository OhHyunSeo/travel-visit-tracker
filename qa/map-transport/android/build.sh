#!/usr/bin/env bash
set -euo pipefail
qa_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
qa_repo="$(cd -- "$qa_root/../../.." && pwd)"
qa_sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
qa_jdk="${JAVA_HOME:-$qa_repo/.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home}"
qa_tools="$qa_sdk/build-tools/36.0.0"
qa_android_jar="$qa_sdk/platforms/android-36/android.jar"
qa_stdlib="${KOTLIN_STDLIB_JAR:-}"
if [[ -z "$qa_stdlib" ]]; then
  qa_stdlib="$(find "$HOME/.gradle/wrapper/dists/gradle-9.3.1-bin" -name kotlin-stdlib-2.2.21.jar -print -quit 2>/dev/null)"
fi
[[ -f "$qa_stdlib" ]] || { echo 'Set KOTLIN_STDLIB_JAR to the existing Kotlin stdlib 2.2.21 jar.' >&2; exit 1; }
mkdir -p "$qa_root/.build/deps" "$qa_root/.build/classes" "$qa_root/.build/dex"
python3 - "$qa_root" "$qa_stdlib" <<'PY'
import hashlib, json, pathlib, sys, urllib.request
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'dependencies.json').read_text())
if hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest() != manifest['kotlinStdlib']['sha256']:
    raise RuntimeError('Existing Kotlin stdlib digest mismatch')
for artifact in manifest['artifacts']:
    path = root / '.build/deps' / artifact['url'].rsplit('/', 1)[1]
    if not path.exists():
        with urllib.request.urlopen(artifact['url'], timeout=30) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise RuntimeError('QA dependency exceeded its small download bound')
        if hashlib.sha256(body).hexdigest() != artifact['sha256']:
            raise RuntimeError('QA dependency digest mismatch')
        path.write_bytes(body)
    if hashlib.sha256(path.read_bytes()).hexdigest() != artifact['sha256']:
        raise RuntimeError('Cached QA dependency digest mismatch')
PY
qa_okhttp="$qa_root/.build/deps/okhttp-4.12.0.jar"
qa_okio="$qa_root/.build/deps/okio-jvm-3.6.0.jar"
"$qa_jdk/bin/javac" -source 8 -target 8 -Xlint:none -classpath "$qa_android_jar:$qa_okhttp:$qa_okio:$qa_stdlib" -d "$qa_root/.build/classes" "$qa_root/src/app/trippainting/maptransportqa/MainActivity.java"
"$qa_jdk/bin/jar" cf "$qa_root/.build/qa-classes.jar" -C "$qa_root/.build/classes" .
JAVA_HOME="$qa_jdk" "$qa_tools/d8" --min-api 26 --lib "$qa_android_jar" --output "$qa_root/.build/dex" "$qa_root/.build/qa-classes.jar" "$qa_okhttp" "$qa_okio" "$qa_stdlib" > "$qa_root/.build/d8.log" 2>&1
"$qa_tools/aapt2" compile --dir "$qa_root/res" -o "$qa_root/.build/resources.zip"
"$qa_tools/aapt2" link -o "$qa_root/.build/qa-unsigned.apk" -I "$qa_android_jar" --manifest "$qa_root/AndroidManifest.xml" --min-sdk-version 26 --target-sdk-version 36 --version-code 1 --version-name 0.1 -R "$qa_root/.build/resources.zip"
(cd "$qa_root/.build/dex" && zip -q -u "$qa_root/.build/qa-unsigned.apk" classes*.dex)
"$qa_tools/zipalign" -f 4 "$qa_root/.build/qa-unsigned.apk" "$qa_root/.build/qa-aligned.apk"
if [[ ! -f "$qa_root/.build/qa-signing.jks" ]]; then
  "$qa_jdk/bin/keytool" -genkeypair -keystore "$qa_root/.build/qa-signing.jks" -storepass android -keypass android -alias qa -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Synthetic Map Transport QA' > "$qa_root/.build/signing.log" 2>&1
fi
JAVA_HOME="$qa_jdk" "$qa_tools/apksigner" sign --ks "$qa_root/.build/qa-signing.jks" --ks-key-alias qa --ks-pass pass:android --key-pass pass:android --out "$qa_root/.build/map-transport-qa.apk" "$qa_root/.build/qa-aligned.apk"
JAVA_HOME="$qa_jdk" "$qa_tools/apksigner" verify "$qa_root/.build/map-transport-qa.apk"
echo "$qa_root/.build/map-transport-qa.apk"
