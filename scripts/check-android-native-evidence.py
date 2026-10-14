"""Validate synthetic Android evidence; never connects to a device or opens its DB."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence', type=Path)
args = parser.parse_args()

def read(name):
    if not (args.evidence / name).is_file():
        parser.exit(2, 'BLOCKED: missing evidence ' + name + '\n')
    return json.loads((args.evidence / name).read_text())

def require(condition, message):
    if not condition:
        raise SystemExit('FAIL: ' + message)

baseline = read('baseline.json')
keys = ['gpsVisits', 'photos', 'pendingOutbox']
for name in ['gps-off-background.json', 'permission-revoked-active-restart.json',
             'background-permission-revoked.json', 'notification-denied-active.json',
             'gap-final.json', 'stopped.json', 'restarted.json']:
    state = read(name)
    require(state['virtualDevice'] and state['integrity'] == 'ok', name + ': emulator/integrity')
    require(all(state[key] == baseline[key] for key in keys), name + ': preserved saved counts')
    if 'photoFiles' in state:
        require(state['photoFiles'] == {'verified': baseline['photos'], 'missing': 0, 'unverified': 0}, name + ': saved photo files')
        require(state['orphanPhotoAssociations'] == 0, name + ': photo ownership/association')
for name in ['gps-off-background.json', 'permission-revoked-active-restart.json', 'stopped.json']:
    state = read(name)
    require(not state['recording'] and state['candidate'] is None and state['diagnostics']['collectorMode'] == 'off', name + ': collectors/candidate stopped')
state = read('background-permission-revoked.json')
require(state['recording'] and state['recordingMode'] == 'background' and state['diagnostics']['collectorMode'] == 'foreground', 'background permission downgrade')
for name in ['notification-denied-active.json', 'restarted.json']:
    state = read(name)
    candidate = state['candidate']
    require(state['recording'] and state['diagnostics']['collectorMode'] == 'background' and candidate is not None and candidate['observedSeconds'] > 0, name + ': real native sample progress')
state = read('gap-final.json')
require(state['recording'] and state['candidate'] is None and state['status'] == 'uncertain', 'gap expired without stopping setting')
require(state['diagnostics']['lastResetAt'] - state['diagnostics']['lastSampleAt'] > 120000, 'gap actual elapsed >120s')
print('PASS: native health scenarios preserve visits/photos/outbox and expected collector transitions')
monitor = read('long-lock-monitor.json')
if not monitor['completed']:
    print('PENDING: 30-minute screen-off monitor, elapsed %.1fs' % monitor['records'][-1]['elapsedSeconds'])
    raise SystemExit(2)
records = monitor['records']
require(len(records) == 31 and records[-1]['elapsedSeconds'] >= 1800, 'full 30-minute evidence')
for index, record in enumerate(records):
    require(record['wakefulness'] in (['Dozing', 'Asleep'] if index == 0 else ['Asleep']), 'screen remains asleep at minute ' + str(index))
    require(record['recording'] and record['collectorMode'] == 'background', 'background recording at minute ' + str(index))
    require(0 <= record['sampleAgeSeconds'] <= 120 and record['integrity'] == 'ok', 'fresh sample/integrity at minute ' + str(index))
    require(record['photoFiles'] == {'verified': baseline['photos'], 'missing': 0, 'unverified': 0}, 'photos at minute ' + str(index))
    require(record['gpsVisits'] in [baseline['gpsVisits'], baseline['gpsVisits'] + 1], 'no duplicate visits')
    require(record['pendingOutbox'] - baseline['pendingOutbox'] == record['gpsVisits'] - baseline['gpsVisits'], 'matching transactional outbox')
require(records[-1]['gpsVisits'] == baseline['gpsVisits'] + 1 and records[-1]['candidateConfirmed'], 'exactly one confirmed dwell')
for index in range(31):
    require(read(f'long-lock-{index:02}.json')['orphanPhotoAssociations'] == 0, 'photo owner/association at minute ' + str(index))
print('PASS: full 30-minute emulator screen-off sampling, single confirmation, photo and outbox preservation')
for name in ['after-screen-return.json', 'after-long-stop.json', 'after-long-restart.json']:
    state = read(name)
    require(state['virtualDevice'] and state['integrity'] == 'ok', name + ': emulator/integrity')
    require(state['gpsVisits'] == baseline['gpsVisits'] + 1 and state['pendingOutbox'] == baseline['pendingOutbox'] + 1, name + ': confirmed visit/outbox restoration')
    require(state['photos'] == baseline['photos'] and state['photoFiles'] == {'verified': baseline['photos'], 'missing': 0, 'unverified': 0} and state['orphanPhotoAssociations'] == 0, name + ': photo restoration')
    if name != 'after-screen-return.json':
        require(not state['recording'] and state['diagnostics']['collectorMode'] == 'off' and state['candidate'] is None, name + ': recording remains off')
print('PASS: screen return, recording stop and process restart preserve confirmed data')
