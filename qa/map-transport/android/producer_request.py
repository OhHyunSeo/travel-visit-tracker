"""Validate producer intent only; never construct or execute a native command.

The aligned size is a design ceiling, not a proven formatter minimum or a
capacity reservation. Caller-supplied claims cannot open the native gate.
"""
from __future__ import annotations

import json

MAX_REQUEST_BYTES = 4096
MAX_REQUESTED_BYTES = 32 * 1024 * 1024
BLOCKERS = (
    'NO_ENFORCED_NATIVE_WRITE_BACKEND',
    'NO_CONFINED_FORMATTER',
    'NO_VERIFIED_PRODUCER_ONLY_ENTRY',
    'NO_VERIFIED_FULL_CHILD_AND_MOUNT_LIFETIME',
)
_FIELDS = frozenset({'schema', 'operation', 'requestedBytes', 'outputName'})


class ProducerRequestError(ValueError):
    """A request was rejected before any controller artifacts were created."""


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProducerRequestError('Duplicate producer request field')
        result[key] = value
    return result


def _reject_constant(_value):
    raise ProducerRequestError('Nonfinite producer request number')


def preflight_request(raw: str | bytes) -> dict:
    """Return diagnostic data, never an execution capability or approval token.

    Serialized input is parsed anew on every call; a caller cannot pass a
    mutated, previously validated dictionary back as an approved request.
    """
    if type(raw) not in (str, bytes) or not 0 < len(raw) <= MAX_REQUEST_BYTES:
        raise ProducerRequestError('Producer request exceeds its input bound or has invalid type')
    try:
        encoded = raw.encode('utf-8') if type(raw) is str else raw
        if len(encoded) > MAX_REQUEST_BYTES:
            raise ProducerRequestError('Producer request exceeds its UTF-8 byte bound')
        request = json.loads(encoded.decode('utf-8'), object_pairs_hook=_unique_pairs,
                             parse_constant=_reject_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ProducerRequestError('Invalid bounded producer request JSON') from error
    if type(request) is not dict or set(request) != _FIELDS:
        raise ProducerRequestError('Producer request must contain only the fixed intent fields')
    if type(request['schema']) is not int or request['schema'] != 1:
        raise ProducerRequestError('Unsupported producer request schema')
    if request['operation'] != 'create-empty-userdata' or request['outputName'] != 'userdata.img':
        raise ProducerRequestError('Only the fixed userdata intent and output name are allowed')
    size = request['requestedBytes']
    if type(size) is not int or not 0 < size <= MAX_REQUESTED_BYTES or size % 512:
        raise ProducerRequestError('Producer size must be aligned and within the design ceiling')
    return {
        'status': 'BLOCKED',
        'scope': 'producer-request-only',
        'requestValid': True,
        'request': request,
        'producerEntryVerified': False,
        'allocationBoundProven': False,
        'imageFormatted': False,
        'nativeAdmissionEnabled': False,
        'blockers': list(BLOCKERS),
    }
