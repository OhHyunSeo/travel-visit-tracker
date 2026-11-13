# Isolated Android MapLibre smoke app

The smoke app has a dedicated package ID, `app.trippainting.maptransportqa.sdk`.
Its Application installs the fixture HTTP provider before starting MapLibre.
The provider uses a pinned certificate for synthetic HTTPS at `127.0.0.1`.
The attempt journal and MapLibre resource cache live inside the app's files
directory. The launcher requests a fixture style with a `fixture-background`
layer and logs the result and reservation totals.

## Compile the startup sources

With JDK 17 and existing Android SDK 36.0.0 build tools, run from this checkout.

```sh
bash qa/map-transport/android/sdk-smoke/verify-android-sources.sh \
  "$okhttp_jar" "$okio_jar" "$kotlin_jar" "$maplibre_aar" \
  "$android_jar" "$android_build_tools"
```

The script verifies the dependencies against the same hashes as the host tests,
compiles against Android 36 and MapLibre 13.6.1, and verifies the startup classes
in the generated DEX. It removes its temporary output on exit. Device execution
and JNI initialization require an APK with its runtime dependencies and fixture
assets.

## Package a Debug APK

Use JDK 17, Gradle 9.3.1, Android platform 36, and Build Tools 36.0.0. The
fixture targets an arm64 device running Android API 36 or newer. Supply the
public DER certificate for the synthetic server, with `127.0.0.1` in its IP
subject alternative names. Keep the corresponding private key on the host.

```sh
bash qa/map-transport/android/sdk-smoke/build-apk.sh \
  "$gradle_executable" "$android_sdk" "$fixture_der" "$fixture_port" "$new_apk"
```

The script stages sources in a temporary directory, resolves dependencies
from Google and Maven Central, and generates a fresh fixture-only signing key.
It verifies the APK signature, package ID, alignment, permissions, app entry
points, MapLibre native library hash, and public assets. The output path must
be new. The reusable Gradle cache is scoped to the Android QA `.build` folder.
Fresh builds use different signing keys, so use a fresh fixture installation
for each build. No production app signing material is used.

## Check the APK and host identity before a run

With JDK 17 and OpenSSL 3, verify the retained build and its matching private
key before starting the server or a guest. Use the APK SHA-256 recorded at
packaging.

```sh
bash qa/map-transport/android/sdk-smoke/verify-runtime-inputs.sh \
  "$verified_apk" "$recorded_sha256" "$fixture_p12" "$android_build_tools"
```

The command verifies the APK signature, package and ABI, loopback certificate,
matching server key, and at least 15 minutes of certificate validity. It prints
the port from the APK for the server and relay. If the test identity expires,
generate a fresh loopback certificate and package a new APK at a separate path.

## Serve the synthetic style

Use the PKCS#12 key store that produced the APK's public certificate. The key
store uses the fixture-only password `fixture-only-password`. Start the server
on the same port embedded in the APK.

```sh
java qa/map-transport/android/sdk-smoke/FixtureStyleServer.java "$fixture_p12" "$fixture_port"
```

The server binds only to Mac loopback and serves a fixed JSON style at
`/resource/style/sdk`. It expects the fixture User-Agent and identity encoding,
rejects credentials and conditional or range headers for this one style, and
logs a fixed reason for any rejected HTTP request. Stop it with Ctrl-C. A device run needs an isolated
connection that reaches this server at the app's loopback address. A successful
run records `TRANSPORT_READY`, `SERVED_STYLE`, and `STYLE_LOADED` with one
attempt, zero tile attempts, and a 4,096-byte reservation in a fresh app sandbox.

## Prepare an emulator loopback connection

The signed APK connects to guest `127.0.0.1`. On a separately admitted Android
Emulator, the relay can forward that connection to the Mac loopback alias
`10.0.2.2` on the same port embedded in the APK. TLS still runs from the APK to
the Mac server. The relay takes one TCP connection, forwards up to 65,536 bytes
in each direction, and times out after 30 seconds. The style response closes
its connection after the single response.

```sh
bash qa/map-transport/android/sdk-smoke/build-relay.sh \
  "$android_jar" "$android_build_tools" "$new_relay_jar"
```

The command compiles the relay against Android 36, verifies its DEX entry point,
and requires a new output path. For a guest run, stage the JAR as a read-only
file in a newly owned guest shell directory, then use `CLASSPATH` pointing to
that file with `app_process /system/bin FixtureLoopbackRelay <fixture_port>`.
Keep the guest relay in the foreground to capture `RELAY_READY` and
`RELAY_COMPLETE`. Host-only preparation does not require ADB or an emulator.

## Check a fresh guest capture

Start a fresh server and relay for the guest run. Collect their stdout as
`server.log` and `relay.log`. Keep these logs local. Capture the fixture's
`TripMapSdkFixture` tag from its current PID in `logcat -v threadtime` format
as `app.log`. After `STYLE_LOADED`, capture `screen.png` while the fixture
activity is still in the foreground. For the newer frame-aware APK, wait for
`FRAME_RENDERED fully=true` after `STYLE_LOADED` before taking the screenshot.
Read `files/transport-budget/budget.journal`
from the same fixture package with `run-as` and save it as `budget.journal`.
The verifier is read-only and uses Python 3 with Pillow.

```sh
python3 -B qa/map-transport/android/sdk-smoke/verify_device_capture.py \
  "$capture_directory" "$verified_apk" --pid "$fixture_pid" --require-render-event
```

The output compares the APK port, server response, relay completion, current
process logs, and the persisted style reservation. The original APK built before
the frame callback can still be checked without `--require-render-event`; its
report records `renderEventObserved=false`. The verifier checks the expected style
color across the center of the screenshot. The server body size, relay bytes,
and reserved body bytes are reported separately. Preserve the original capture
files with their device provenance. Synthetic input only tests the verifier.

An admitted guest runner can call `capture_device.collect()` after the relay
exits. `capture_transport.for_admitted_transport()` can supply its command
callback using an existing transport ID and the runner's identity check. The
callback checks identity before and after each command, enforces stdout and
stderr limits and a deadline, and fails on a nonzero exit. The collector
checks that the fixture is the sole resumed activity before and after the
screenshot, verifies the PID again before saving screen or journal data, and
writes only to a new private capture directory. It leaves partial evidence on
failure. There is no device selection or launch command in this module.
