#!/usr/bin/env python3
"""Prepare only the checksum-pinned physical-iPhone QA framework, never Pods/SPM."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import urllib.request
import zipfile

root = Path(__file__).resolve().parent
spec = json.loads((root / 'dependency.json').read_text())
rn = spec['rnNativeTransform']
rn_root = (root / rn['packageRelativePath']).resolve()
if json.loads((rn_root / 'package.json').read_text())['version'] != rn['version']:
    raise RuntimeError('Installed native transform package version differs from the QA pin')
for name, digest in rn['sources'].items():
    source = rn_root / 'ios/modules/transform-request' / name
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Installed native transform source changed; preserve and inspect it')
rn_license = (rn_root / 'LICENSE.md').read_bytes()
if hashlib.sha256(rn_license).hexdigest() != rn['licenseSha256']:
    raise RuntimeError('Installed transform package license changed')
build = root / '.build'
if build.is_symlink():
    raise RuntimeError('QA build directory must not be a link')
build.mkdir(exist_ok=True)
archive = build / f"MapLibre-{spec['version']}.zip"
if not archive.exists():
    # Exclusive new file; on failure leave the partial file for inspection.
    with urllib.request.urlopen(spec['url'], timeout=30) as source, archive.open('xb') as target:
        total = 0
        while body := source.read(65536):
            total += len(body)
            if total > spec['archiveBytes']:
                raise RuntimeError('SDK archive exceeds its published size')
            target.write(body)
if archive.is_symlink() or not archive.is_file() or archive.stat().st_nlink != 1 or archive.stat().st_size != spec['archiveBytes']:
    raise RuntimeError('Unexpected SDK archive path or size; preserve and inspect it')
if hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
    raise RuntimeError('SDK archive checksum differs from the official release')

target = build / 'sdk'
if target.is_symlink():
    raise RuntimeError('SDK destination must be an owned regular directory')
target.mkdir(exist_ok=True)


def destination(relative):
    path = target
    for part in relative.parts[:-1]:
        path = path / part
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise RuntimeError('SDK destination parent is not an owned directory')
        path.mkdir(exist_ok=True)
    path = path / relative.name
    if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_nlink != 1)):
        raise RuntimeError('SDK destination file must not be a link')
    return path


manifest = {}
with zipfile.ZipFile(archive) as source:
    entries = source.infolist()
    if len(entries) > 512 or sum(item.file_size for item in entries) > spec['maxUnpackedBytes']:
        raise RuntimeError('SDK archive exceeds the unpacked bound')
    for item in entries:
        parts = PurePosixPath(item.filename)
        if parts.is_absolute() or '..' in parts.parts or stat.S_ISLNK(item.external_attr >> 16):
            raise RuntimeError('Unexpected SDK archive path or link')
        if not item.filename.startswith(spec['slice']) or item.is_dir():
            continue
        relative = parts.relative_to(PurePosixPath(spec['slice']))
        path = destination(Path('MapLibre.framework') / Path(*relative.parts))
        body = source.read(item)
        digest = hashlib.sha256(body).hexdigest()
        if path.exists():
            if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Existing QA SDK file changed; preserve and inspect it')
        else:
            if not path.resolve().is_relative_to(target.resolve()):
                raise RuntimeError('SDK destination escapes the owned directory')
            with path.open('xb') as output:
                output.write(body)
            path.chmod(0o755 if relative.name == 'MapLibre' else 0o644)
        manifest[str(path.relative_to(build))] = {'sha256': digest, 'bytes': len(body)}
    license_body = source.read('LICENSE.md')
    license_path = destination(Path('LICENSE.md'))
    if license_path.exists():
        if license_path.read_bytes() != license_body:
            raise RuntimeError('QA SDK license changed')
    else:
        with license_path.open('xb') as output:
            output.write(license_body)
rn_license_path = destination(Path('MapLibre-RN-Native-LICENSE.md'))
if rn_license_path.exists():
    if rn_license_path.read_bytes() != rn_license:
        raise RuntimeError('Existing native transform license changed')
else:
    with rn_license_path.open('xb') as output:
        output.write(rn_license)
manifest_path = build / 'sdk-manifest.json'
manifest_body = json.dumps(manifest, indent=2)
if manifest_path.is_symlink() or (manifest_path.exists() and (not manifest_path.is_file() or manifest_path.stat().st_nlink != 1)):
    raise RuntimeError('SDK manifest must not be a link')
if manifest_path.exists():
    if manifest_path.read_text() != manifest_body:
        raise RuntimeError('Existing SDK manifest changed; preserve and inspect it')
else:
    with manifest_path.open('x') as output:
        output.write(manifest_body)
print(json.dumps({'checksumVerified': True, 'physicalSliceFiles': len(manifest),
                  'physicalSliceBytes': sum(item['bytes'] for item in manifest.values()),
                  'nativeTransformVersion': rn['version'], 'nativeTransformSourceHashesMatch': True}))
