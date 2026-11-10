"""Stage the separate React Native QA shell from the existing generated iOS inputs."""

import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PRODUCT = ROOT / 'travel_visit_tracker'
BUNDLE = 'app.trippainting.rnmapqa'


def stage(name):
    build = HERE / '.build'
    build.mkdir(exist_ok=True)
    assert not build.is_symlink()
    target = build / name
    target.mkdir(mode=0o700)
    ios = target / 'ios'
    ios.mkdir()
    for item in ('TripPainting', 'TripPainting.xcodeproj', 'TripPainting.xcworkspace', 'Pods', 'build'):
        subprocess.run(['cp', '-cR', '-P', str(PRODUCT / 'ios' / item), str(ios / item)], check=True)
    for item in ('Podfile.lock', 'Podfile.properties.json'):
        shutil.copyfile(PRODUCT / 'ios' / item, ios / item)
    (target / 'node_modules').symlink_to(PRODUCT / 'node_modules', target_is_directory=True)
    cached_packages = PRODUCT / '.build' / 'ios' / 'SourcePackages'
    subprocess.run(['cp', '-cR', '-P', str(cached_packages), str(target / 'SourcePackages')], check=True)

    app = ios / 'TripPainting'
    for name in ('AppDelegate.swift', 'TPRNBootstrap.h', 'TPRNBootstrap.m'):
        shutil.copyfile(HERE / name, app / name)
    for name in ('TPTransport.h', 'TPTransport.m', 'TPHTTPExchange.h', 'TPHTTPExchange.m'):
        shutil.copyfile(HERE.parent / 'ios' / name, app / name)
    (app / 'TripPainting-Bridging-Header.h').write_text('#import "TPRNBootstrap.h"\n')
    (app / 'TripPainting.entitlements').unlink()
    (ios / '.xcode.env').write_text('export NODE_BINARY="${TP_RN_NODE:?Set TP_RN_NODE}"\n')
    (app / 'Info.plist').write_bytes(plistlib.dumps({
        'CFBundleDisplayName': 'React Native 지도 시험', 'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)',
        'CFBundleExecutable': '$(EXECUTABLE_NAME)', 'CFBundlePackageType': 'APPL',
        'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': '$(PRODUCT_NAME)',
        'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': '1',
        'UILaunchStoryboardName': 'SplashScreen',
        'NSLocalNetworkUsageDescription': '별도 시험용 지도 서버에 연결합니다.',
        'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False,
            'UISceneConfigurations': {'UIWindowSceneSessionRoleApplication': [{
                'UISceneDelegateClassName': 'TPRNQAScene', 'UISceneConfigurationName': 'QA',
            }]}},
    }))
    (target / 'app.json').write_text(json.dumps({'expo': {'name': 'RN Map QA', 'slug': 'rn-map-qa',
                                                        'ios': {'bundleIdentifier': BUNDLE}}}))
    deps = json.loads((PRODUCT / 'package.json').read_text())['dependencies']
    (target / 'package.json').write_text(json.dumps({'name': 'trip-painting-rn-map-qa', 'version': '0.1.0',
        'private': True, 'main': 'index.js', 'dependencies': {k: deps[k] for k in
            ('expo', 'react', 'react-native', '@maplibre/maplibre-react-native')}}))
    shutil.copyfile(HERE / 'index.js', target / 'index.js')
    (target / 'babel.config.js').write_text("module.exports = { presets: ['babel-preset-expo'] };\n")
    (target / 'metro.config.js').write_text("""const fs = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [...new Set([...config.watchFolders, fs.realpathSync('./node_modules')])];
module.exports = config;
""")
    print(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('name', help='name for a new owned QA staging directory')
    args = parser.parse_args()
    if not args.name.isascii() or not args.name.replace('-', '').isalnum():
        parser.error('use an ASCII name with letters, digits and hyphens')
    stage(args.name)
