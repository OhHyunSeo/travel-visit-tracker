"""Check non-destructive emulator launch arguments without launching a device."""
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).resolve().parents[1] / 'travel_visit_tracker/scripts/android-emulator.sh'
with tempfile.TemporaryDirectory(prefix='trip-android-emulator-') as temp:
    root = Path(temp)
    (root / 'sdk/emulator').mkdir(parents=True)
    (root / 'sdk/platform-tools').mkdir(parents=True)
    log = root / 'calls'
    def tool(path, body):
        path.write_text('#!/bin/bash\nset -eu\n' + body)
        path.chmod(0o755)
    tool(root / 'sdk/emulator/emulator', '''case "$1" in
  -help-gpu) echo '     swiftshader -> software'; echo '     host -> host' ;;
  -list-avds) echo Medium_Phone_API_37.0 ;;
  *) echo "emulator $*" >> "$CALL_LOG" ;;
esac
''')
    tool(root / 'sdk/platform-tools/adb', '''echo "adb $*" >> "$CALL_LOG"
echo 'List of devices attached'
if [[ "${EXISTING_EMULATOR:-0}" == 1 ]]; then printf 'emulator-5554\\tdevice\\n'; fi
''')
    env = {**os.environ, 'ANDROID_HOME': str(root / 'sdk'), 'CALL_LOG': str(log)}
    for key in ['ANDROID_AVD', 'ANDROID_GPU_MODE']:
        env.pop(key, None)
    def run(extra=None):
        log.write_text('')
        result = subprocess.run(['bash', str(script)], env={**env, **(extra or {})}, capture_output=True, text=True, errors='replace')
        return result, log.read_text()
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert '-cores 4 -gpu swiftshader' in calls and '-port 5554 -no-snapshot' in calls, calls
    assert '-wipe-data' not in calls and '-no-window -grpc-use-token' in calls, calls
    result, calls = run({'EXISTING_EMULATOR': '1'})
    assert result.returncode != 0 and 'emulator -avd' not in calls, calls
    for extra in [{'ANDROID_GPU_MODE': 'bad'}, {'ANDROID_GPU_MODE': 'swangle'}, {'ANDROID_AVD': 'missing'}]:
        result, calls = run(extra)
        assert result.returncode != 0 and 'emulator -avd' not in calls, calls
print('PASS: data-preserving CPU/GPU launch, existing emulator guard, unsupported GPU/AVD rejection')
