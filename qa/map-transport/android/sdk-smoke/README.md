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

## Serve the synthetic style

Use the PKCS#12 key store that produced the APK's public certificate. The key
store uses the fixture-only password `fixture-only-password`. Start the server
on the same port embedded in the APK.

```sh
java qa/map-transport/android/sdk-smoke/FixtureStyleServer.java "$fixture_p12" "$fixture_port"
```

The server binds only to Mac loopback and serves a fixed JSON style at
`/resource/style/sdk`. Stop it with Ctrl-C. A device run needs an isolated
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
