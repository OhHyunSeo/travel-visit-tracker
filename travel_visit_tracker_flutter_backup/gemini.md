# Flutter Development Tips

## Launching iOS Simulator
If `flutter run` doesn't list any iOS simulators:
1. List available devices: `xcrun simctl list devices`
2. Boot a device: `xcrun simctl boot <UUID>` (e.g., `xcrun simctl boot DB6D03D2-BBAA-461D-8328-59F5673CF436`)
3. Open Simulator app: `open -a Simulator`
4. Run `flutter devices` to verify.
