"""Run the RN map app on a fresh simulator against a pinned loopback fixture."""

import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import select
import subprocess
import sys
import tempfile
import time
import uuid


HERE = Path(__file__).resolve().parent
QA = HERE.parent
NODE = HERE.parents[2] / ".tooling/node_modules/.bin/node"
BUNDLE = "app.trippainting.rnmapqa"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-2"
DEVICE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17"

sys.path.insert(0, str(QA / "ios"))
sys.path.insert(0, str(QA / "ios-maplibre"))
from test_tls_exchange import make_certificate
from tls_cancel_capture import FixtureControl
from tls_result import _certificate, _need, _same


def save(output, name, value):
    (output / (name + ".json")).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify(result, ledger, server, origin, certificate, run, pid):
    _need(result.get("complete") is True and result.get("pass") is True
          and result.get("delegatePreserved") is True and result.get("runID") == run
          and result.get("process") == pid, "native RN case or process differs")
    native = result["native"]
    _need(native.get("transport") == "pinned-private-tls-http1-fixture"
          and native.get("ledgerOK") is True
          and all(_same(native.get(key), 0) for key in
                  ("active", "pending", "blockedBeforeDispatch", "cancelledActive", "cancelledPending"))
          and all(_same(native.get(key), 3) for key in
                  ("started", "released", "httpRequestSendsSettled", "tlsVerifiedExchanges")),
          "native exchange counts differ")
    expected = {"schema": 1, "origin": origin, "requests": 3, "tiles": 1, "reservedBytes": 768,
                "maxRequests": 8, "maxTiles": 4, "maxReservedBytes": 2048, "reservationBytes": 256,
                "unresolved": []}
    _need(_same(native["ledger"], ledger)
          and _same({key: ledger.get(key) for key in expected}, expected), "native and stored ledger differ")
    _certificate(ledger.get("fixtureTLSLeafDER"), certificate)
    _need(_same(server.get("active"), 0) and _same(server.get("heldActive"), 0)
          and server.get("heldReleased") is False and _same(server.get("resourceCount"), 3),
          "fixture did not finish three resources")
    requests = server["requests"]
    paths = ["/resource/style/sdk", "/resource/tile/0_0_0", "/resource/style/empty"]
    _need([request.get("path") for request in requests] == paths, "fixture resource order differs")
    total = 0
    for request in requests:
        size = request.get("bytes")
        _need(type(size) is int and 0 < size <= 256 and _same(request.get("bytesWritten"), size)
              and request.get("finished") is True and request.get("closedBeforeFinish") is False
              and request.get("held") is False and request.get("receivedAuthHeader") is False
              and request.get("cookieHeader") is False
              and request.get("ua") == "TripPaintingMapTransportQA/1.0"
              and request.get("alpn") == "http/1.1"
              and request.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"), "fixture exchange differs")
        total += size
    _need(_same(native.get("acceptedBodyBytes"), total), "native and server body totals differ")
    return {"validated": True, "runtime": RUNTIME, "bundle": BUNDLE, "resources": paths,
            "verifiedHTTPSExchanges": 3, "acceptedBodyBytes": total}


def run(app, output, directory):
    device_set = directory / "devices"
    device_set.mkdir()
    sim = ["xcrun", "simctl", "--set", str(device_set)]

    def command(*args, timeout=30, **options):
        return subprocess.run([*sim, *args], text=True, capture_output=True, check=True,
                              timeout=timeout, **options).stdout.strip()

    run_id = "rn-" + secrets.token_hex(12)
    device_id = str(uuid.UUID(command("create", run_id, DEVICE, RUNTIME)))
    try:
        command("boot", device_id, timeout=60)
        command("bootstatus", device_id, "-b", timeout=120)
        command("install", device_id, str(app), timeout=45)
        make_certificate(directory, "fixture", "IP:127.0.0.1")
        certificate = (directory / "fixture.der").read_bytes()
        (output / "fixture.der").write_bytes(certificate)
        fixture = subprocess.Popen([str(NODE), str(QA / "fixture/sdk-server.mjs"),
                                    "--host", "127.0.0.1", "--port", "0",
                                    "--tls-key", str(directory / "fixture.key"),
                                    "--tls-cert", str(directory / "fixture.pem")],
                                   stdout=subprocess.PIPE, text=True)
        try:
            _need(select.select([fixture.stdout], [], [], 5)[0], "fixture startup timed out")
            readiness = json.loads(fixture.stdout.readline())
            origin = readiness["origin"]
            _need(readiness.get("ready") is True and readiness.get("synthetic") is True
                  and origin.startswith("https://127.0.0.1:"), "wrong fixture")
            control = FixtureControl(origin, certificate)
            initial = control.request("/stats", time.monotonic() + 3)
            _need(_same(initial, {"active": 0, "maxActive": 0, "heldActive": 0, "heldReleased": False,
                                  "resourceCount": 0, "requests": []}), "fixture was not fresh")
            env = {key: value for key, value in os.environ.items() if not key.startswith("SIMCTL_CHILD_")}
            env.update(SIMCTL_CHILD_QA_SERVER_ORIGIN=origin, SIMCTL_CHILD_QA_RUN_ID=run_id,
                       SIMCTL_CHILD_QA_TLS_LEAF_DER_BASE64=base64.b64encode(certificate).decode("ascii"))
            launch = command("launch", device_id, BUNDLE, env=env)
            process = re.fullmatch(re.escape(BUNDLE) + r": (\d+)", launch)
            _need(process is not None, "unexpected simulator launch result")
            pid = int(process.group(1))
            save(output, "run", {"runID": run_id, "origin": origin, "process": pid})
            data = Path(command("get_app_container", device_id, BUNDLE, "data")).resolve()
            _need(data.is_relative_to(device_set), "app data is outside the private device set")
            documents = data / "Documents" / run_id
            result = {}
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                try:
                    result = json.loads((documents / "result.json").read_text())
                except FileNotFoundError:
                    pass
                if result.get("complete") is True:
                    break
                time.sleep(0.2)
            server = control.request("/stats", time.monotonic() + 3)
            save(output, "server", server)
            save(output, "result", result)
            if result.get("pass") is not True:
                (output / "runtime-private.log").write_text(command(
                    "spawn", device_id, "log", "show", "--last", "2m", "--style", "compact",
                    "--predicate", 'process == "TripPainting"'))
            ledger = json.loads((documents / "ledger.json").read_text())
            save(output, "ledger", ledger)
            save(output, "summary", verify(result, ledger, server, origin, certificate, run_id, pid))
        finally:
            if fixture.poll() is None:
                fixture.terminate()
                try:
                    fixture.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    fixture.kill()
                    fixture.wait(timeout=5)
    finally:
        try:
            subprocess.run([*sim, "shutdown", device_id], capture_output=True, timeout=60)
        finally:
            command("delete", device_id, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("output", type=Path, help="a new evidence directory")
    args = parser.parse_args()
    app = args.app.resolve()
    _need(app.is_relative_to(HERE / ".build") and app.is_dir() and app.name == "TripPainting.app",
          "expected an app built in the owned QA staging area")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    _need(info.get("CFBundleIdentifier") == BUNDLE
          and "iPhoneSimulator" in info.get("CFBundleSupportedPlatforms", [])
          and "UIBackgroundModes" not in info and "CFBundleURLTypes" not in info,
          "expected an isolated simulator app")
    args.output.mkdir(mode=0o700)
    with tempfile.TemporaryDirectory(prefix="tp-rn-map-") as directory:
        run(app, args.output, Path(directory).resolve())
    print((args.output / "summary.json").read_text(), end="")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.stderr or str(error))
