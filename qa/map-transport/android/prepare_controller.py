#!/usr/bin/env python3
"""Run bounded controller preparation only. Native admission always stays closed."""
from __future__ import annotations

import argparse
import json
import pathlib

from bounded_controller import ControllerArtifacts, ControllerError
from producer_request import BLOCKERS, ProducerRequestError, preflight_request


def _write_records(artifacts: ControllerArtifacts, backing_bytes: int | None,
                   producer_preflight: dict | None) -> tuple[dict, dict]:
    artifacts.write('outside-canary', b'trip-painting-controller-canary\n')
    event = {
        'phase': 'bounded-controller-created',
        'backingReservedBytes': backing_bytes or 0,
    }
    if producer_preflight is not None:
        event['producerPreflight'] = producer_preflight
    artifacts.write_json('controller-events.json', event)
    if backing_bytes is not None:
        artifacts.initialize_backing()
    artifacts.write('output.txt', b'Controller preparation only; native commands were not run.\n')
    result = {
        'schema': 1,
        'status': 'BLOCKED',
        'scope': 'controller-and-optional-flat-backing-only',
        'backingInitialized': backing_bytes is not None,
        'imageFormatted': False,
        'nativeAdmissionEnabled': False,
        'allocationBoundProven': False,
        'blockers': list(BLOCKERS),
        'cleanup': 'PENDING',
    }
    if producer_preflight is not None:
        result['producerPreflight'] = producer_preflight
    artifacts.write_json('result.json', result)
    audit = artifacts.audit()
    if audit['status'] != 'READY':
        raise ControllerError('Controller preparation integrity failed')
    return result, audit


def prepare(android_root: pathlib.Path, *, backing_bytes: int | None = None,
            producer_request: str | bytes | None = None) -> dict:
    """Write bounded artifacts; preserve exact failure location and cleanup.

    result.json deliberately does not contain a recursive final audit of itself.
    The returned controllerAudit is taken after every artifact has been written;
    cleanup describes closing the descriptors afterward, without deleting files.
    """
    # Parse intent before creating even an empty run. This report is diagnostic;
    # neither a valid request nor flat backing initialization enables a producer.
    producer_preflight = (preflight_request(producer_request)
                          if producer_request is not None else None)
    artifacts = ControllerArtifacts.create(android_root, backing_bytes=backing_bytes)
    try:
        with artifacts:
            result, audit = _write_records(artifacts, backing_bytes, producer_preflight)
    except ControllerError as error:
        raise ControllerError(str(error), cleanup_report=artifacts.cleanup_report,
                              controller_root=str(artifacts.root)) from error
    return {**result, 'controllerRoot': str(artifacts.root),
            'controllerAudit': audit, 'cleanup': artifacts.cleanup_report}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--android-root', required=True, type=pathlib.Path)
    parser.add_argument('--backing-bytes', type=int)
    parser.add_argument('--producer-request', help='Bounded JSON intent only; no producer is run')
    args = parser.parse_args(argv)
    try:
        result = prepare(args.android_root, backing_bytes=args.backing_bytes,
                         producer_request=args.producer_request)
    except ProducerRequestError as error:
        print(json.dumps({'status': 'FAILED', 'error': str(error),
                          'controllerRoot': None, 'cleanup': None,
                          'allocationBoundProven': False, 'imageFormatted': False,
                          'producerEntryVerified': False, 'nativeAdmissionEnabled': False}))
        return 1
    except ControllerError as error:
        print(json.dumps({'status': 'FAILED', 'error': str(error),
                          'controllerRoot': error.controller_root,
                          'cleanup': error.cleanup_report,
                          'nativeAdmissionEnabled': False}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 2  # Preparation success is still blocked for native execution.


if __name__ == '__main__':
    raise SystemExit(main())
