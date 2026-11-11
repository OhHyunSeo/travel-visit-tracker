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
