#!/usr/bin/env python3
"""Run synthetic OkHttp checks only on an already running Android emulator.

The app has a separate application ID. No Metro, provider requests, HTTP adb
reverse, personal-app launch, DB repository, auth or location APIs are used.
"""
import argparse
import json
import os
import pathlib
import re
import shlex
import subprocess
import time
import urllib.request
import uuid

from qa_avd_guard import (AvdGuardError, claim_first_validation,
                          inspect_owned_emulator, verify_pinned_transport)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--port', type=int, default=3188)
    parser.add_argument('--qa-avd-dir', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not args.serial.startswith('emulator-') or not 1024 <= args.port <= 65535:
        raise SystemExit('An emulator and nonprivileged fixture port are required')
    root = pathlib.Path(__file__).resolve().parent
    sdk = pathlib.Path(os.environ.get('ANDROID_HOME', pathlib.Path.home() / 'Library/Android/sdk')).resolve()
    adb = sdk / 'platform-tools/adb'
    package = 'app.trippainting.maptransportqa'
    original = 'app.trippainting.mobile'
    prefix = 'run_' + uuid.uuid4().hex[:10]
    # Verify local ownership and the actual live host data path before any app command.
    owned_avd = inspect_owned_emulator(args.serial, args.qa_avd_dir, root, sdk, adb)
    output = root / '.build/validation' / prefix
    installed = False

    def command(*parts, check=True):
        verify_pinned_transport(owned_avd, sdk)
        result = subprocess.run([str(adb), '-t', str(owned_avd['transportId']), *parts], capture_output=True, text=True, timeout=20)
        verify_pinned_transport(owned_avd, sdk)
        if check and result.returncode:
            raise RuntimeError('Scoped adb operation failed: ' + result.stderr.strip())
        return result.stdout.strip()

    def shell(value, check=True):
        return command('shell', value, check=check)

    def control(path):
        with urllib.request.urlopen(f'http://127.0.0.1:{args.port}{path}', timeout=5) as response:
            return json.load(response)

    def wait_for(probe, predicate, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = probe()
            if predicate(value):
                return value
            time.sleep(.1)
        raise RuntimeError('Synthetic check did not settle before its limit')

    def baseline():
        # A fresh QA AVD must not contain the personal application at all.
        # Do not read its files, SQLite databases or authentication values.
        if shell('getprop sys.boot_completed') != '1':
            raise RuntimeError('The dedicated QA AVD has not completed boot')
        if shell(f'cmd package list packages -U {original}'):
            raise RuntimeError('Personal app found in QA AVD; refusing any private data access')
        return {
            'personalAppAbsent': True,
            'personalAppFilesRead': False,
            'network': {key: shell('settings get global ' + key) for key in ['airplane_mode_on', 'wifi_on', 'mobile_data']},
            'screenTimeout': shell('settings get system screen_off_timeout'),
        }

    def read_result():
        value = command('exec-out', 'run-as', package, 'cat', 'files/result.json', check=False)
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return {}

    def launch(scenario, run):
        shell(f'am force-stop {package}')
        shell('am start -n ' + package + '/.MainActivity --es origin ' +
              shlex.quote(f'http://10.0.2.2:{args.port}') + ' --es scenario ' +
              shlex.quote(scenario) + ' --es run_id ' + shlex.quote(run))

    def completed(scenario, run):
        launch(scenario, run)
        result = wait_for(read_result, lambda value: value.get('done') and value.get('run_id') == run and value.get('scenario') == scenario)
        assert not result.get('fatal'), result.get('fatal')
        assert result['scenario'] == scenario
        wait_for(lambda: control('/stats'), lambda value: value['active'] == 0)
        return result, control('/stats')

    def check_headers(stats):
        for item in stats['requests']:
            assert item['ua'] == 'TripPaintingMapTransportQA/0.1 (synthetic fixture only)'
            assert not item['receivedAuthHeader'] and not item['cookieHeader']

    before = baseline()
    if shell(f'pm path {package}', check=False):
        raise RuntimeError('QA package already exists; refusing to replace unowned app')
    assert control('/stats')['active'] == 0
    claim_first_validation(owned_avd, prefix)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'isolation-proof.json').write_text(json.dumps(owned_avd, indent=2) + '\n')
    (output / 'environment-before.json').write_text(json.dumps(before, indent=2) + '\n')
    results = {}
    try:
        command('install', str(root / '.build/map-transport-qa.apk'))
        installed = True
        qa_uid = re.search(r'uid:(\d+)', shell('cmd package list packages -U ' + package)).group(1)
        assert qa_uid, 'Installed QA application UID unavailable'
        for scenario in ['batch', 'reject', 'bodies', 'budget', 'tile-budget']:
            control('/reset')
            result, stats = completed(scenario, prefix + '_' + scenario.replace('-', '_'))
            (output / (scenario + '.json')).write_text(json.dumps({'result': result, 'server': stats}, indent=2) + '\n')
            check_headers(stats)
            success = sum(item['success'] for item in result['results'])
            if scenario == 'batch':
                assert stats['resourceCount'] == 12 and stats['maxActive'] == 4
                assert result['batchClientCount'] == 2 and result['maxNativeBodies'] == 4
                assert success == 12 and result['ledger']['acceptedBodyBytes'] == 768
            elif scenario == 'reject':
                assert stats['resourceCount'] == 1 and stats['nonControlRequestCount'] == 1
                assert success == 0 and result['ledger']['attempts'] == 1
                assert stats['invalidRouteCount'] == 0 and stats['invalidQueryCount'] == 0
            elif scenario == 'bodies':
                assert stats['resourceCount'] == 5 and success == 1
                assert result['ledger']['acceptedBodyBytes'] == 64
                assert result['ledger']['chargedBodyBytes'] == 640
            elif scenario == 'budget':
                assert stats['resourceCount'] == 64 and success == 64
                assert result['ledger']['chargedBodyBytes'] == 8192
                assert len(result['results']) == 70
            elif scenario == 'tile-budget':
                assert stats['resourceCount'] == 40 and success == 40
                assert result['ledger']['tileAttempts'] == 40
                assert len(result['results']) == 45
            results[scenario] = {'result': result, 'server': stats}
            (output / (scenario + '.json')).write_text(json.dumps(results[scenario], indent=2) + '\n')

        control('/reset')
        run = prefix + '_restart'
        launch('hold', run)
        held = wait_for(read_result, lambda value: value.get('phase') == 'holding' and value.get('run_id') == run)
        wait_for(lambda: control('/stats'), lambda value: value['active'] == 1)
        old_pid = shell('pidof ' + package)
        assert held['ledger']['attempts'] == 1 and held['ledger']['chargedBodyBytes'] == 128
        shell('am force-stop ' + package)
        wait_for(lambda: control('/stats'), lambda value: value['active'] == 0)
        control('/release')
        inspected, stats = completed('inspect', run)
        new_pid = shell('pidof ' + package)
        assert old_pid and new_pid and old_pid != new_pid
        assert stats['resourceCount'] == 1 and inspected['ledger'] == held['ledger']
        assert inspected['ledger']['entries'][0]['status'] == 'pending'
        resumed, stats = completed('resume', run)
        check_headers(stats)
        assert stats['resourceCount'] == 2 and resumed['ledger']['attempts'] == 2
        assert resumed['ledger']['chargedBodyBytes'] == 256
        assert resumed['ledger']['acceptedBodyBytes'] == 64
        assert resumed['ledger']['entries'][0]['status'] == 'pending'
        assert resumed['ledger']['entries'][1]['status'] == 'success'
        results['restart'] = {'held': held, 'inspected': inspected, 'resumed': resumed, 'server': stats, 'pidChanged': True}
        (output / 'restart.json').write_text(json.dumps(results['restart'], indent=2) + '\n')
    finally:
        # One failed cleanup step must not skip the remaining owned actions.
        failures = []
        actions = [('force-stop', lambda: shell('am force-stop ' + package)),
                   ('fixture-release', lambda: control('/release'))]
        if installed:
            actions.append(('uninstall-qa', lambda: command('uninstall', package)))
        for name, action in actions:
            try:
                action()
            except Exception as error:
                failures.append({'step': name, 'error': type(error).__name__})
        try:
            after = baseline()
            (output / 'environment-after.json').write_text(json.dumps(after, indent=2) + '\n')
            if after != before:
                failures.append({'step': 'environment-compare', 'error': 'baseline differs'})
        except Exception as error:
            failures.append({'step': 'environment-compare', 'error': type(error).__name__})
        (output / 'cleanup.json').write_text(json.dumps({'failures': failures}, indent=2) + '\n')
        if failures:
            raise RuntimeError('Owned cleanup incomplete; inspect the saved cleanup report')
    summary = {
        'standaloneAndroidApi37Debug': 'PASS', 'scenarioGroups': len(results),
        'dedicatedQaAvdOwnership': 'PASS',
        'originalPersonalAppAbsentBeforeAndAfter': True, 'personalDataFilesRead': False,
        'networkAndScreenSettings': 'MATCH', 'qaPackageRemoved': not bool(shell('cmd package list packages -U ' + package)),
        'originalAppFilesApkUidAuthComparison': 'NOT RUN; personal app absent from fresh QA AVD',
        'mapLibreIntegrated': False, 'physicalAndroid': 'NOT RUN', 'release': 'NOT RUN',
        'osReceivedByteHardCap': 'NOT PROVEN', 'metric': 'accepted fixture body bytes plus conservative nonrefunded reservations',
        'httpAdbReverse': False, 'providerRequests': 0,
    }
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary))


if __name__ == '__main__':
    try:
        main()
    except AvdGuardError as error:
        raise SystemExit('Refused emulator validation: ' + str(error)) from error
