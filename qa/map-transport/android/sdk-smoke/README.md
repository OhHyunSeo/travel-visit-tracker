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

## Rehearse the complete request on the Mac

With JDK 17, OpenSSL 3 and Python 3 with Pillow, run the released MapLibre Java
request wrapper through the same relay and server with the APK's port and
certificate. Leave that port free for this command to bind on Mac loopback.

```sh
bash qa/map-transport/android/sdk-smoke/verify-host-smoke.sh \
  "$verified_apk" "$recorded_sha256" "$fixture_p12" "$android_build_tools" \
  "$okhttp_jar" "$okio_jar" "$kotlin_jar" "$maplibre_aar" "$android_jar"
```

The check compares one HTTPS style response and its persisted reservation.
The released Java wrapper uses a zero JNI pointer during this host rehearsal.
Guest startup and map rendering require the separate device capture.

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

Before installing, an admitted runner can call `device_preflight.check_fresh_device()`
through its pinned transport. The check requires a completed Android boot, API
36 or later and arm64-v8a, and checks that the product and fixture packages are
absent. It does not establish device ownership or launch readiness on its own.

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
exits. Pass the expected hash from the APK's preflight to reject a changed host
artifact before or during capture. `capture_transport.for_admitted_transport()` can supply its command
callback using an existing transport ID and the runner's identity check. The
callback checks identity before and after each command, enforces stdout and
stderr limits and a deadline, and fails on a nonzero exit. The collector
compares the fixture package's installed `base.apk` hash before and after capture.
It rejects split or unrelated APK paths.

## Verify one synthetic raster tile

The same signed smoke APK accepts `/resource/tile/0_0_0`. Start
`FixtureStyleServer.java` with its PKCS#12 path, the APK's port, and `--raster-tile`.
Build a new relay with `build-relay.sh` and use the cold boot component with
`--probe-adb --fixture-apk` and `--render-fixture RELAY SERVER_LOG CAPTURE --raster-tile`.
The relay handles two connections under one deadline. The server sends a
localhost-only raster style and a 512×512 PNG for the single zoom-zero tile.

Replay the saved capture with `verify_device_capture.py CAPTURE APK --pid PID
--raster-tile`. The verifier requires the exact style and tile request sequence,
two persisted reservations in order, the fixture's completed frame and the
tile color in the foreground screenshot. The style-only invocation remains
available for earlier captures.

## Store one synthetic offline pack

Build a fresh signed APK with `build-apk.sh` and check its digest and certificate
with `verify-runtime-inputs.sh`. Use the raster server and relay with the same
isolated boot command and add `--offline-pack --fixture-apk-sha256 DIGEST`.
The fixture opens no map view. It starts with an empty offline region listing,
downloads one zoom-zero region, then queries the same region ID, metadata and
completed status again. The capture compares its two resources with two server
responses and two on-device reservations. A process restart and cache-only
render are separate checks.

## Reopen the installed pack with the server stopped

Build and verify the APK that includes the reopen activity. Add
`--reopen-pack /absolute/path/to/java /absolute/path/to/fixture.p12` to the
offline pack command, and give `--render-fixture` a new server log and capture
directory. The runner starts and stops its loopback server. It waits for the
guest relay to finish, verifies that the server port refuses a connection, then
force-stops just the fixture package and starts the same installation again.

The capture requires two different PIDs, the same region ID and metadata, an
unchanged SQLite link and payload hash for both the style and the tile, and a
foreground screenshot that shows the synthetic tile. It compares the request
journal before and after reopening and checks the app's transport count three
seconds after the first complete frame. Replay it independently with
`verify_pack_reopen.py CAPTURE --port PORT --first-pid PID --reopened-pid PID`.

Add `--expire-pack` to the runner and the replay command to check expired
resources. The server sends a one-second cache lifetime. The capture confirms
both SQLite expiration times precede the new process and reports how many
requests entered the fixture transport. New server responses and journal
reservations must remain zero with the server stopped.

Add `--sdk-offline` with `--expire-pack` to make the separate trial require
MapLibre's disconnected state and zero transport calls while the expired tile
is displayed. The offline flag is set before the map is constructed.

Add `--online-recovery` to that trial to restart the synthetic server after the
offline frame. The server uses the same origin and certificate with a fresh
cache lifetime and a differently colored tile. The runner sends the reconnect
intent to the existing Android activity. The two screen captures, view identity,
PID, separate server logs, journal records, and the final database are checked
by `verify_online_recovery.py CAPTURE --port PORT --first-pid PID --map-pid PID`.
checks that the fixture is the sole resumed activity before and after the
screenshot, verifies the PID again before saving screen or journal data, and
writes only to a new private capture directory. It leaves partial evidence on
failure. There is no device selection or launch command in this module.
