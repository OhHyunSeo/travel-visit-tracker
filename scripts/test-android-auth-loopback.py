"""Check auth loopback isolation with fake tools; no APK, account or DB changes."""
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).resolve().parents[1] / 'travel_visit_tracker/scripts/android-auth-loopback.sh'
with tempfile.TemporaryDirectory(prefix='trip-auth-loopback-') as temp:
    root = Path(temp)
    sdk = root / 'sdk/platform-tools'
    sdk.mkdir(parents=True)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    log = root / 'calls'
    def tool(path, body):
        path.write_text('#!/bin/bash\nset -eu\n' + body)
        path.chmod(0o755)
    tool(sdk / 'adb', '''echo "adb $*" >> "$CALL_LOG"
if [[ "$*" == *get-state ]]; then echo device; fi
if [[ "$*" == *ro.kernel.qemu ]]; then echo "${QEMU_VALUE:-1}"; fi
''')
    tool(bin_dir / 'curl', '''echo "curl $*" >> "$CALL_LOG"
if [[ "${SERVER_UP:-1}" != 1 ]]; then exit 7; fi
''')
    env = {**os.environ, 'ANDROID_HOME': str(root / 'sdk'), 'ANDROID_SERIAL': 'emulator-5554',
           'CALL_LOG': str(log), 'PATH': str(bin_dir) + ':' + os.environ['PATH']}
    env.pop('ANDROID_AUTH_PORT', None)
    def run(extra=None, action=None):
        log.write_text('')
        result = subprocess.run(['bash', str(script)] + ([action] if action else []),
                                env={**env, **(extra or {})}, capture_output=True, text=True, errors='replace')
        return result, log.read_text()
    result, calls = run()
    assert result.returncode == 0 and 'http://127.0.0.1:3002/health' in calls and 'reverse tcp:3002 tcp:3002' in calls, calls
    assert 'am start' not in calls and 'install' not in calls, calls
    result, calls = run({'ANDROID_AUTH_PORT': '3012'})
    assert result.returncode == 0 and 'reverse tcp:3012 tcp:3012' in calls, calls
    for port in ['3000', '3001', '8081', '8082', 'bad', '08082', '65536']:
        result, calls = run({'ANDROID_AUTH_PORT': port})
        assert result.returncode != 0 and not calls, (port, calls)
    result, calls = run({'ANDROID_SERIAL': 'physical-device'})
    assert result.returncode != 0 and not calls, calls
    for extra in [{'QEMU_VALUE': '0'}, {'SERVER_UP': '0'}]:
        result, calls = run(extra)
        assert result.returncode != 0 and ' reverse ' not in calls, calls
    result, calls = run({'SERVER_UP': '0'}, '--remove')
    assert result.returncode == 0 and 'reverse --remove tcp:3002' in calls and 'curl' not in calls, calls
    result, calls = run(action='--help')
    assert result.returncode == 0 and not calls, calls
print('PASS: loopback health gate, separate ports, emulator-only guard, scoped cleanup; no app/account action')
