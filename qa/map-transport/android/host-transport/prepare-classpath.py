import hashlib
from pathlib import Path
import sys
import zipfile


EXPECTED_DEPENDENCIES = (
    'b1050081b14bb7a3a7e55a4d3ef01b5dcfabc453b4573a4fc019767191d5f4e0',
    '67543f0736fc422ae927ed0e504b98bc5e269fda0d3500579337cb713da28412',
    '6558a3d233da56a20934b32159f9db5f86ed5816ef098f78a2c223dc6abb79dd',
)
AAR_SHA256 = '0a8ea4f5bfd268e050c72025d0f2952b60861863eba6caf84e19b8da583f3a42'
JAR_SHA256 = 'ac36e99396ebb01ff781e090c7b9b1557b4d1ccecac653ef511c775a3570136b'


def prepare(arguments):
    if len(arguments) not in (3, 5):
        raise SystemExit('Expected three dependency jars and optional MapLibre AAR and output jar')
    for filename, digest in zip(arguments[:3], EXPECTED_DEPENDENCIES):
        path = Path(filename)
        if path.stat().st_size > 8_388_608 or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Unexpected host test dependency: {path.name}')
    if len(arguments) == 3:
        return
    archive = Path(arguments[3])
    if archive.stat().st_size != 15_598_638 or hashlib.sha256(archive.read_bytes()).hexdigest() != AAR_SHA256:
        raise SystemExit('Unexpected MapLibre OpenGL 13.6.1 AAR')
    with zipfile.ZipFile(archive) as source:
        classes = source.read('classes.jar')
    if hashlib.sha256(classes).hexdigest() != JAR_SHA256:
        raise SystemExit('Unexpected MapLibre classes.jar')
    with Path(arguments[4]).open('xb') as output:
        output.write(classes)


if __name__ == '__main__':
    prepare(sys.argv[1:])
