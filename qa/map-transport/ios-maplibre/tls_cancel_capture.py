"""Record SDK HTTPS cancel/reload evidence from a prepared iPhone and fixture."""

import argparse
import base64
import hmac
from http.client import HTTPException, HTTPResponse
from io import BytesIO
import json
from pathlib import Path
import secrets
import socket
import ssl
import time
from urllib.parse import urlsplit

import action_delivery as device_tools
from tls_cancel_result import validate_drained_server, validate_waiting_server
from tls_result import EvidenceError, _need, _origin, _same


STAGE = "tls-cancel-retry"
PHASES = (10, 12, 12, 13)
ATTEMPTS = (
    {"accepted": True, "phaseBefore": 10, "phaseAfter": 11, "sequenceBefore": 0, "sequenceAfter": 1},
    {"accepted": False, "phaseBefore": 12, "phaseAfter": 12, "sequenceBefore": 1, "sequenceAfter": 1},
    {"accepted": True, "phaseBefore": 12, "phaseAfter": 13, "sequenceBefore": 1, "sequenceAfter": 2},
)
MAX_CONTROL_WIRE = 32 * 1024


class BufferedReply:
    def __init__(self, wire):
        self.wire = wire

    def makefile(self, _mode):
        return BytesIO(self.wire)


class FixtureControl:
    """Use an explicit local origin and exact leaf before writing control HTTP."""

    def __init__(self, origin, certificate):
        address = urlsplit(_origin(origin))
        _need(type(certificate) is bytes and 0 < len(certificate) <= 16384, "invalid public DER size")
        self.address = (address.hostname, address.port)
        self.certificate = certificate
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.context.check_hostname = False
        self.context.verify_mode = ssl.CERT_NONE  # Exact out-of-band leaf checked before any HTTP.
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.context.set_alpn_protocols(["http/1.1"])

    def request(self, route, deadline):
        _need(route in ("/stats", "/release-held"), "unsupported fixture control route")
        deadline = min(deadline, time.monotonic() + 3)

        def remaining():
            value = deadline - time.monotonic()
            _need(value > 0, "HTTPS fixture control deadline elapsed")
            return value

        host, port = self.address
        request = (f"GET {route} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                   "Accept: application/json\r\nConnection: close\r\n\r\n").encode("ascii")
        wire = bytearray()
        try:
            with socket.create_connection(self.address, timeout=remaining()) as tcp:
                tcp.settimeout(remaining())
                with self.context.wrap_socket(tcp, server_hostname=host) as connection:
                    peer = connection.getpeercert(binary_form=True)
                    _need(peer is not None and hmac.compare_digest(peer, self.certificate),
                          "HTTPS fixture leaf differs")
                    _need(connection.selected_alpn_protocol() == "http/1.1", "HTTPS fixture ALPN differs")
                    connection.settimeout(remaining())
                    connection.sendall(request)
                    while len(wire) <= MAX_CONTROL_WIRE:
                        connection.settimeout(remaining())
                        part = connection.recv(min(4096, MAX_CONTROL_WIRE + 1 - len(wire)))
                        if not part:
                            break
                        wire.extend(part)
            _need(len(wire) <= MAX_CONTROL_WIRE, "HTTPS fixture control response exceeds bound")
            with HTTPResponse(BufferedReply(wire)) as response:
                response.begin()
                _need(response.version == 11 and response.status == 200
                      and response.headers.get_content_type() == "application/json",
                      "HTTPS fixture control response differs")
                body = response.read()
        except (OSError, HTTPException):
            raise EvidenceError("HTTPS fixture control exchange failed") from None
        return device_tools._json_object(body)


def _progress(value, run, pid, step, phase=None):
    expected = {"kind": "fixture-action-progress", "stage": STAGE, "runID": run,
                "process": pid, "phase": PHASES[step] if phase is None else phase,
                "sequence": (0, 1, 1, 2)[step], "attempts": list(ATTEMPTS[:step])}
    _need(_same({key: value.get(key) for key in expected}, expected),
          f"TLS scene progress differs at observation {step}")
    native = value.get("native")
    _need(isinstance(native, dict) and native.get("ledgerOK") is True
          and native.get("transport") == "pinned-private-tls-http1-fixture",
          "TLS scene progress lacks a valid native snapshot")
    return native


def _at_step(value, run, pid, step):
    attempts = value.get("attempts")
    _need(isinstance(attempts, list), "TLS scene attempts are absent")
    if len(attempts) < step:
        phase = 11 if len(attempts) == 1 and value.get("phase") == 11 else None
        _progress(value, run, pid, len(attempts), phase)
        return False
    if step == 1 and len(attempts) == 1 and value.get("phase") == 11:
        _progress(value, run, pid, step, phase=11)
        return False
    return True


def _wait_initial_progress(device, run, deadline):
    end = min(deadline, time.monotonic() + 8)
    while time.monotonic() < end:
        try:
            return device_tools._copy(device, run, "action-progress.json", end)
        except (device_tools.CoreDeviceError, FileNotFoundError):
            time.sleep(min(0.15, max(0, end - time.monotonic())))
    raise EvidenceError("timed out waiting for initial HTTPS scene progress")


def _wait_server(fixture, folder, filename, ready, deadline):
    end = min(deadline, time.monotonic() + 5)
    value = None
    while time.monotonic() < end:
        value = fixture.request("/stats", end)
        if ready(value):
            break
        time.sleep(min(0.15, max(0, end - time.monotonic())))
    if value is not None:
        device_tools._save(folder, filename, value)
    _need(value is not None and ready(value), f"fixture did not reach {filename[:-5]} state")
    return value


def _waiting(value):
    return (type(value.get("active")) is int and value["active"] == 4
            and type(value.get("heldActive")) is int and value["heldActive"] == 4
            and value.get("heldReleased") is False)


def _idle(value):
    return all(type(value.get(key)) is int and value[key] == 0 for key in ("active", "heldActive"))


def capture_observations(device, folder, origin, certificate):
    """Observe only a preinstalled and stopped QA app, using a fresh HTTPS fixture."""
    fixture = FixtureControl(origin, certificate)
    folder.mkdir(mode=0o700)
    deadline = time.monotonic() + 16
    lock = device_tools._device(device, ("info", "lockState"), deadline=deadline)
    _need(lock.get("passcodeRequired") is False and lock.get("unlockedSinceBoot") is True,
          "unlock the device before running the TLS scene trial")
    _need(not device_tools._processes(device, deadline), "the QA app is already running")
    initial = fixture.request("/stats", deadline)
    device_tools._save(folder, "server-initial.json", initial)
    _need(_same(initial, {"active": 0, "maxActive": 0, "heldActive": 0, "resourceCount": 0,
                         "heldReleased": False, "requests": []}), "fixture was not fresh")

    run = "tlscancel-" + secrets.token_hex(12)
    device_tools._save(folder, "run.json", {"runID": run})
    nonces = {signal: secrets.token_hex(32) for signal in ("cancel", "reload")}
    _need(nonces["cancel"] != nonces["reload"], "fixture nonce collision")
    environment = {"QA_STAGE": STAGE, "QA_RUN_ID": run, "QA_SERVER_ORIGIN": origin,
                   "QA_TLS_LEAF_DER_BASE64": base64.b64encode(certificate).decode("ascii"),
                   "QA_FIXTURE_CANCEL_NONCE": nonces["cancel"],
                   "QA_FIXTURE_RELOAD_NONCE": nonces["reload"]}
    deadline = time.monotonic() + 43
    pid, executable = device_tools._launched(device, ("--environment-variables", json.dumps(environment)), deadline)
    device_tools._save(folder, "launch.json", {"process": pid})

    def progress(step):
        if step == 0:
            value = _wait_initial_progress(device, run, deadline)
        else:
            value = device_tools._wait_for_document(device, run, "action-progress.json",
                                                     lambda item: _at_step(item, run, pid, step), deadline)
        device_tools._save(folder, f"progress-{step}.json", value)
        return _progress(value, run, pid, step)

    def send(step, signal):
        url = f"trippainting-map-qa-control://{signal}?runID={run}&pid={pid}&nonce={nonces[signal]}"
        observed = device_tools._launched(device, ("--payload-url", url), deadline)
        device_tools._save(folder, f"payload-{step}.json", {"process": observed[0], "signal": signal})
        _need(observed == (pid, executable), "CoreDevice reported a different QA process")

    waiting = progress(0)
    _need(type(waiting.get("active")) is int and waiting["active"] == 4
          and type(waiting.get("pending")) is int and waiting["pending"] > 0,
          "native scene is not waiting with four active requests")
    before = _wait_server(fixture, folder, "server-before.json", _waiting, deadline)
    validate_waiting_server(before, origin)
    send(1, "cancel")

    drained = progress(1)
    _need(all(type(drained.get(key)) is int and drained[key] == 0 for key in ("active", "pending")),
          "native scene did not drain")
    after = _wait_server(fixture, folder, "server-drained.json", _idle, deadline)
    validate_drained_server(after, before, origin)
    send(2, "cancel")
    _need(_same(progress(2), drained), "native counters changed after duplicate rejection")

    released = fixture.request("/release-held", deadline)
    device_tools._save(folder, "release.json", released)
    _need(_same(released, {"heldReleased": True, "releasedOpenBodies": 0}),
          "release revived old fixture bodies")
    send(3, "reload")
    progress(3)

    final = device_tools._wait_for_document(device, run, "result.json", device_tools._completed, deadline)
    device_tools._save(folder, "result.json", final)
    ledger = device_tools._copy(device, run, "tls-ledger.json", deadline)
    device_tools._save(folder, "ledger.json", ledger)
    _wait_server(fixture, folder, "server-final.json", _idle, deadline)
    matching = [row for row in device_tools._processes(device, deadline) if row["executable"] == executable]
    _need(len(matching) == 1, "the launched QA executable was not observed once")
    observed_pid = device_tools._pid(matching[0].get("processIdentifier"))
    device_tools._save(folder, "process-after.json", {"process": observed_pid})
    _need(observed_pid == pid, "the original process was not observed after the signals")


def capture(device, folder, origin, certificate):
    capture_observations(device, folder, origin, certificate)
    from tls_cancel_result import verify
    return verify(folder, origin, certificate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="explicitly selected iPhone")
    parser.add_argument("--origin", required=True, help="exact private HTTPS fixture origin")
    parser.add_argument("--certificate", required=True, type=Path, help="fixture's public DER leaf")
    parser.add_argument("evidence", type=Path, help="new private directory under docs/test-results")
    args = parser.parse_args()
    try:
        with args.certificate.open("rb") as source:
            leaf = source.read(16385)
        result = capture(args.device, args.evidence, args.origin, leaf)
    except (EvidenceError, OSError, ValueError) as error:
        # Process environment and URL arguments contain private per-run nonces.
        detail = str(error) if isinstance(error, EvidenceError) else type(error).__name__
        parser.exit(1, f"TLS scene trial could not be verified: {detail}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
