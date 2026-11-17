# Android React Native pack recovery fixture

This separate APK exercises the product recovery function from a fixed Git commit.
It starts a fresh Expo SQLite operation and creates a MapLibre pack through the
installed React Native module. The test saves the operation before creating the
pack and leaves the returned SDK ID unsaved. Recovery must bind that exact ID
and report completion. The synthetic loopback HTTPS style offers the single
zoom-eight tile for the selected fixture region.

Use Node 24.21.0, JDK 17, Gradle 9.3.1 and the installed Android 36 build tools
and Expo-selected NDK. Stage with `bash stage.sh PRODUCT_SHA CERT_DER PORT`
from this directory. The output directory contains a copy of the locked
dependencies, the archived product source, and its own Android user and Gradle
directories. Build `:app:assembleDebug` with `--project-dir STAGE/android`,
`--gradle-user-home STAGE/gradle-home`, `ANDROID_USER_HOME=STAGE/android-user`,
`EXPO_OFFLINE=1`, and `EXPO_NO_DOTENV=1`. The signed debug APK is under
`STAGE/android/app/build/outputs/apk/debug/`. It includes the JS bundle and
uses no Metro server at runtime.

Run the following command from the repository root. It takes the signed APK
hash, pinned two-connection relay JAR, matching synthetic HTTPS identity and a
new evidence directory. The 10 GiB disposable volume requires 15 GiB of free
host space, including the 5 GiB headroom.

```sh
python3 -B qa/map-transport/android/avd_boot_component.py \
  --sdk-root "$ANDROID_HOME" --probe-adb \
  --fixture-apk "$FIXTURE_APK" --fixture-apk-sha256 "$FIXTURE_APK_SHA" \
  --rn-recovery "$RELAY_JAR" "$JAVA_BINARY" "$FIXTURE_P12" "$CAPTURE_DIR"
```

The runner checks the signed APK, API level, arm64 ABI and certificate before
provisioning the disposable emulator. Inside the emulator it stages the relay,
installs only the QA package and captures the recovery result. It verifies the
same SDK ID in the process log, Expo SQLite operation and MapLibre SQLite
metadata. It also checks the linked style and tile rows, two synthetic server
responses and the native request journal. Replay an existing capture using
`python3 -B qa/map-transport/android/rn_recovery.py CAPTURE --port PORT --pid PID`.

With an APK built from the fixture that supports the relaunch, add `--rn-reopen`
to the boot command. The runner stops the server, checks that its port refuses
connections and restarts the same installation. It requires a new process, the
same completed pack and SQLite content, and zero new transport calls or journal
reservations. Add `--reopened-pid PID` when replaying that capture.
