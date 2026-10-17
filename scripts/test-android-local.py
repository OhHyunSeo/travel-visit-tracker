"""Check Android launcher isolation using fake tools, without touching a device."""
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).resolve().parents[1] / 'travel_visit_tracker/scripts/android-local.sh'
with tempfile.TemporaryDirectory(prefix='trip-android-launcher-') as temp:
    root = Path(temp)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    sdk = root / 'sdk/platform-tools'
    sdk.mkdir(parents=True)
    log = root / 'calls'
    def tool(path, body):
        path.write_text('#!/bin/bash\nset -eu\n' + body)
        path.chmod(0o755)
    tool(sdk / 'adb', 'echo "adb $*" >> "$CALL_LOG"\nif [[ "$*" == *get-state ]]; then echo device; fi\n')
    tool(bin_dir / 'curl', 'echo "curl $*" >> "$CALL_LOG"\nif [[ "${METRO_RUNNING:-1}" == 1 ]]; then echo packager-status:running; fi\n')
    tool(bin_dir / 'npx', 'echo "npx $*" >> "$CALL_LOG"\n')
    env = {**os.environ, 'ANDROID_HOME': str(root / 'sdk'), 'TRIP_NODE_BIN': str(bin_dir),
           'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'CALL_LOG': str(log), 'ANDROID_SERIAL': 'emulator-5554'}
    env.pop('ANDROID_METRO_PORT', None)
    def run(extra=None):
        log.write_text('')
        result = subprocess.run(['bash', str(script)], env={**env, **(extra or {})}, capture_output=True, text=True, errors='replace')
        return result, log.read_text()
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert 'reverse tcp:8082 tcp:8082' in calls and '127.0.0.1%3A8082' in calls, calls
    assert '8081' not in calls and 'npx' not in calls, calls
    result, calls = run({'ANDROID_METRO_PORT': '8083'})
    assert result.returncode == 0 and 'tcp:8083' in calls and '127.0.0.1%3A8083' in calls, calls
    result, calls = run({'METRO_RUNNING': '0'})
    assert result.returncode == 0 and 'npx expo start --dev-client --localhost --port 8082' in calls, (result.stderr, calls)
    for port in ['8081', 'bad', '0', '65536', '08082', '999999999999999999999']:
        result, calls = run({'ANDROID_METRO_PORT': port})
        assert result.returncode != 0 and not calls, (port, calls)
    result, calls = run({'ANDROID_SERIAL': 'physical-device'})
    assert result.returncode != 0 and not calls, calls
print('PASS: default/custom port, existing/new Metro, reserved/invalid ports, physical device rejection')
