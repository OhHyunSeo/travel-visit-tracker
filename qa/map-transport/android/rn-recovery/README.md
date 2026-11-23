# Android React Native pack recovery fixture

This separate APK exercises the product recovery function from a fixed Git commit.
It starts a fresh Expo SQLite operation and creates a MapLibre pack through the
installed React Native module. The test saves the operation before creating the
pack and leaves the returned SDK ID unsaved. Recovery must bind that exact ID
and report completion. The synthetic loopback HTTPS style offers the single
zoom-eight tile for the selected fixture region.

Use Node 24.21.0, JDK 17, Gradle 9.3.1 and the installed Android 36 build tools
and Expo-selected NDK. Stage with `bash stage.sh PRODUCT_SHA CERT_DER PORT`
from this directory. The product commit must contain `savedBackgroundMap.native.ts`
and the Android offline maps package template. The output directory contains a copy of the locked
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

Add `--rn-product-map` together with `--rn-reopen` to exercise the product
`RegionMap` component. The fixture uses the product Android offline maps package
and loads the stored style via `getSavedBackgroundMap`. The runner taps the QA
background switch and captures saved, disabled and restored frames in the same
app process. It compares tile and region samples, the style bytes, SQLite pack
identity and the transport and reservation evidence. Add `--product-map` when
replaying that capture.

`--rn-product-tab` selects the actual product `app/(tabs)/index.tsx` route
in a minimal Expo Router layout. The runner verifies the initial boundary map
and presses the screen's own saved-map and boundary-map buttons. It retains
the four frames and corresponding UI layouts. Use `--product-tab` for replay.

With `--rn-source-bounds`, the runner also reads the active native MapView's
loaded source at all four tab phases. It compares the source bounds with the
saved operation and checks that the original tile URLs and zoom range remain.
Boundary-only frames must have no saved raster source. Bounds comparisons use
an absolute tolerance of 0.00001 degrees for native coordinate serialization.
Add `--source-bounds` to replay this evidence.

`--rn-zoom 9` selects the independent zoom-nine synthetic pack. The default
selects zoom eight. Both use the same region, one style and one tile per fresh
installation, with a distinct tile color per zoom. Replay the zoom-nine capture
with `--zoom 9`. These trials verify separate fixed-zoom packs.

`--rn-multi-zoom --rn-reopen --rn-product-tab --rn-source-bounds` uses one
pack with the zoom-eight and zoom-nine tiles. Use the pinned three-connection
relay built from `sdk-smoke/FixtureLoopbackRelay.java`. The download must link
both distinct tile coordinates to the same region and report three resources,
two tiles and three request reservations. After stopping the server, the runner
reopens the same installation, drives the product buttons, then moves the
restored native MapView camera to zoom eight and nine. It captures each color
and requires the same view identity and source bounds, unchanged SQLite content
and request journal, and zero new transport calls. Replay with `--multi-zoom`
together with `--product-tab --source-bounds --reopened-pid PID`.

`--rn-adjacent-tiles --rn-reopen --rn-product-tab --rn-source-bounds` selects
the pinned boundary dataset's Yangyang fixture region. Its bounds cross tiles
`9/438/197` and `9/439/197` at the fixed zoom nine. The left tile is orange and
the right tile blue. This mode reuses the three-connection relay and requires
both tiles in the same region, three resources/reservations, and both colors
in saved/restored frames in left-to-right order. Both colors must disappear on
the boundary-only map. The runner compares each tile's restored location and
stored bytes after an offline app restart. Use `--adjacent-tiles` for replay
with `--product-tab --source-bounds --reopened-pid PID`. This mode is separate
from `--rn-multi-zoom` and `--rn-zoom 9`.

`--rn-row-tiles --rn-reopen --rn-product-tab --rn-source-bounds` uses the
pinned dataset's northern Goseong fixture region, crossing `9/438/196` and
`9/438/197`. The northern tile is orange and the southern tile blue. It reuses
the same three-connection relay and checks both linked tiles, both colors in
one saved/restored frame, top-to-bottom order and unchanged restored locations.
Replay with `--row-tiles --product-tab --source-bounds --reopened-pid PID`.
The row mode excludes the other tile/zoom modes and reports its samples under
`rowTiles`; the previous left/right trial remains under `adjacentTiles`.

`--rn-row-pan` adds two bounded vertical gestures after the row-map buttons.
It reuses the existing row APK and its `zoom9` source inspector; each generated
inspector file is removed before collecting a fresh observation. The host keeps
separate `pan-south`/`pan-north` screenshots and source snapshots. The observer
requires the same process, MapView, source and zoom, opposite latitude changes,
at least 300 southern raster samples and four times the baseline, then a northern
view with fewer southern samples. Replay with `--row-pan --row-tiles` and the
usual product-tab/source-bounds arguments. This observation is not accepted if
only the camera moves or the wider-tile criterion fails. The first native attempt
in the November 22 progress record did not meet that criterion.

The November 23 host observer keeps the same gestures and raster acceptance.
After the initial 0.75-second wait it collects at most six source/frame pairs,
separated by at least 0.5 seconds, and selects only the first three consecutive
pairs with an identical sampled RGB grid and centers within 1e-7 degrees of the
first pair. Every pair must retain the baseline process, MapView, source and zoom.
Raw observations live under `pan-*/observations/NN`; `settling.json` records the
bounded selection. Replay verifies those files and the final selected pair.
The reused native inspector reasserts zoom 9 with `moveCamera`, so this establishes
stability under that inspection procedure, not the natural end time of inertia.

`row-pan-observations.json` separates bare raster counts from the expected
unvisited-region overlay colors, using the existing grid and RGB tolerance.
Overlay counts are diagnostic and never satisfy the 300/four-times raster gate.
A settled view can still fail that gate. Historical captures without a settling
report remain readable; they do not establish consecutive-frame stability.

The next prospective plan, `coastal-start-v1`, prepares an eastern start with
a 500ms horizontal swipe from (63%,45%) to (38%,45%) before the same vertical
gestures. The source camera must move 0.08–0.16 degrees east and retain its
latitude within 1e-5 degrees, source, process and zoom. It collects three stable
pairs at `pan-start` and uses that prepared frame as the four-times baseline.
The threshold remains max(300, four times that baseline), with the same grid,
color tolerance and northern-view conditions. The plan is written before input
to `row-pan-plan.json` and checked during replay. Original `restored` frames and
previous 73→195 failures stay separate; old captures without a plan still replay
against their original restored baseline.

The plan was chosen from a host-only Web Mercator projection of the bundled
2020 synthetic fixture at 720×1280, zoom 9 and density 2: the estimated start
longitude is 128.5278, bare blue samples about 248, and a conservative southern
latitude of 38.31 yields about 1,463. Attribution, antialiasing and actual gesture
motion require device verification; these estimates are not native results.

`post-map-checks.json` now records visual and persistence results independently.
Even if visual capture/acceptance fails, the runner attempts the final request
journal, app/MapLibre stores, server-closed probe and stored-style/source checks.
The visit-storage audit and map log are attempted before stopping the app.
Either failed branch keeps the overall command failed; collecting final stores
does not convert a failed visual gate to a pass.
