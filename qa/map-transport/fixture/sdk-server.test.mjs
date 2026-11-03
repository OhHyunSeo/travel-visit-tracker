import assert from "node:assert/strict";
import { after, test } from "node:test";
import https from "node:https";
import tls from "node:tls";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { createSDKFixture, readTLSFixtureFile, syntheticRasterStyle, syntheticRasterTile } from "./sdk-server.mjs";

let certificateDirectory, certificate;
function tlsMaterials() {
  if (!certificate) {
    certificateDirectory = mkdtempSync(join(tmpdir(), "tp-sdk-tls-fixture-"));
    writeFileSync(join(certificateDirectory, "openssl.cnf"), "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n", { mode: 0o600 });
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", join(certificateDirectory, "openssl.cnf"), "-keyout", join(certificateDirectory, "leaf.key"), "-out", join(certificateDirectory, "leaf.pem")], { stdio: "ignore", timeout: 15000 });
    certificate = { key: readFileSync(join(certificateDirectory, "leaf.key")), cert: readFileSync(join(certificateDirectory, "leaf.pem")) };
  }
  return certificate;
}
after(() => { if (certificateDirectory) rmSync(certificateDirectory, { recursive: true }); });

function openHTTPS(origin, path, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(origin + path, { ca: tlsMaterials().cert, ALPNProtocols: ["h2", "http/1.1"], agent: false, ...options }, response => {
      const chunks = [];
      const body = new Promise((done, fail) => {
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => done(Buffer.concat(chunks)));
        response.on("error", fail);
      });
      body.catch(() => {}); // Cancellation is asserted after headers have arrived.
      resolve({ request, response, body, alpn: response.socket.alpnProtocol, protocol: response.socket.getProtocol() });
    });
    request.setTimeout(2000, () => request.destroy(new Error("fixture test deadline")));
    request.on("error", reject);
  });
}

test("original indexed PNG is 256px with bounded decompressed and encoded bytes", () => {
  const tile = syntheticRasterTile();
  assert.ok(tile.length <= 256);
  assert.deepEqual([...tile.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(tile.readUInt32BE(16), 256);
  assert.equal(tile.readUInt32BE(20), 256);
  assert.equal(tile[24], 1);
  assert.equal(tile[25], 3);
  let offset = 8, raw;
  while (offset < tile.length) {
    const size = tile.readUInt32BE(offset);
    if (tile.toString("ascii", offset + 4, offset + 8) === "IDAT") raw = inflateSync(tile.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  assert.deepEqual(raw, Buffer.alloc(33 * 256));
  assert.equal(offset, tile.length);
});

test("style fits reservation at longest supported IPv4 HTTP/HTTPS origins with one zoom-zero raster source", () => {
  for (const scheme of ["http", "https"]) {
  for (const [blocked, multi] of [[false, false], [true, false], [false, true]]) {
    const bytes = syntheticRasterStyle(`${scheme}://192.168.255.255:65535`, blocked, multi);
    assert.ok(bytes.length <= 256);
    const style = JSON.parse(bytes);
    assert.equal(style.version, 8);
    assert.equal(style.sources.t.maxzoom, multi ? 2 : 0);
    assert.equal(style.sources.t.minzoom, multi ? 2 : 0);
    assert.equal(style.sources.t.tileSize, 256);
    assert.equal(style.layers[0].type, "raster");
    assert.equal(style.sources.t.tiles[0].includes("example.invalid"), blocked);
  }
  const held = syntheticRasterStyle(`${scheme}://192.168.255.255:65535`, false, false, true);
  assert.ok(held.length <= 256);
  assert.equal(JSON.parse(held).sources.t.maxzoom, 2);
  assert.ok(JSON.parse(held).sources.t.tiles[0].includes("/tile/h_"));
  }
});

test("held SDK bodies wait for explicit release; empty style contains no resources", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  const empty = await fetch(`${fixture.origin}/resource/style/empty`);
  assert.deepEqual(await empty.json(), { version: 8, sources: {}, layers: [] });
  await fetch(`${fixture.origin}/reset`);
  const response = await fetch(`${fixture.origin}/resource/tile/h_2_0_0`);
  assert.equal(fixture.stats().heldActive, 1);
  assert.equal(fixture.stats().requests[0].bytesWritten, 0);
  assert.equal((await fetch(`${fixture.origin}/reset`)).status, 409);
  const released = await (await fetch(`${fixture.origin}/release-held`)).json();
  assert.deepEqual(released, { heldReleased: true, releasedOpenBodies: 1 });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticRasterTile());
  assert.equal(fixture.stats().resourceCount, 1);
  assert.equal(fixture.stats().heldActive, 0);
  assert.equal(fixture.stats().requests[0].finished, true);
  await fetch(`${fixture.origin}/reset`);
  assert.equal(fixture.stats().heldReleased, false);
});

test("cancelled held body stays unsent; release and same-path retry cannot revive it", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  const controller = new AbortController();
  const path = "/resource/tile/h_2_0_0";
  const response = await fetch(fixture.origin + path, { signal: controller.signal });
  const body = response.arrayBuffer();
  controller.abort(); controller.abort();
  await assert.rejects(body);
  const end = performance.now() + 1000;
  while (fixture.stats().active && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fixture.stats().heldActive, 0);
  assert.equal(fixture.stats().requests[0].closedBeforeFinish, true);
  assert.equal(fixture.stats().requests[0].bytesWritten, 0);
  assert.deepEqual(await (await fetch(`${fixture.origin}/release-held`)).json(), { heldReleased: true, releasedOpenBodies: 0 });
  const retry = await fetch(fixture.origin + path);
  assert.deepEqual(Buffer.from(await retry.arrayBuffer()), syntheticRasterTile());
  assert.deepEqual(fixture.stats().requests.map(x => x.path), [path, path]);
  assert.equal(fixture.stats().requests[0].finished, false);
  assert.equal(fixture.stats().requests[1].finished, true);
});

test("held fixture shutdown closes its body without a later release write", async () => {
  const fixture = await createSDKFixture();
  const response = await fetch(`${fixture.origin}/resource/tile/h_2_0_0`);
  await fixture.close();
  await assert.rejects(response.arrayBuffer());
  assert.equal(fixture.stats().heldActive, 0);
  assert.equal(fixture.stats().active, 0);
  assert.equal(fixture.stats().requests[0].bytesWritten, 0);
});

test("held control requires exact GET path and never counts as an SDK resource", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  for (const path of ["/release-held?x=1", "/release-held/", "/resource/tile/h_2_4_0", "/resource/style/held?x=1"]) assert.equal((await fetch(fixture.origin + path)).status, 404);
  assert.equal((await fetch(`${fixture.origin}/release-held`, { method: "POST" })).status, 405);
  assert.equal(fixture.stats().heldReleased, false);
  assert.equal(fixture.stats().resourceCount, 0);
});

test("multi-tile fixture holds four actual body lifetimes and refuses reset while active", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  const style = await (await fetch(`${fixture.origin}/resource/style/multi`)).json();
  assert.equal(style.sources.t.minzoom, 2);
  assert.equal(style.sources.t.maxzoom, 2);
  await fetch(`${fixture.origin}/reset`);
  const responses = await Promise.all(["2_0_0", "2_0_1", "2_1_0", "2_1_1"].map(id => fetch(`${fixture.origin}/resource/tile/${id}`)));
  assert.equal(fixture.stats().active, 4);
  assert.equal((await fetch(`${fixture.origin}/reset`)).status, 409);
  const bodies = await Promise.all(responses.map(response => response.arrayBuffer()));
  assert.ok(bodies.every(body => Buffer.from(body).equals(syntheticRasterTile())));
  assert.equal(fixture.stats().maxActive, 4);
  assert.equal(fixture.stats().active, 0);
});

test("multi-tile fixture cancels a delayed body and shuts down without a late write", async () => {
  const fixture = await createSDKFixture();
  const response = await fetch(`${fixture.origin}/resource/tile/2_0_0`);
  assert.equal(fixture.stats().active, 1);
  await fixture.close();
  await assert.rejects(response.arrayBuffer());
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(fixture.stats().active, 0);
  assert.equal(fixture.stats().requests[0].bytesWritten, 0);
});

test("fixture serves valid style and PNG with exact length and scoped header-presence records", async t => {
  const fixture = await createSDKFixture();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.origin}/resource/style/sdk`, { headers: { "User-Agent": "synthetic-sdk", Authorization: "synthetic-only", Cookie: "synthetic-only" } });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, Number(response.headers.get("content-length")));
  const style = JSON.parse(body);
  assert.equal(style.sources.t.tiles[0], `${fixture.origin}/resource/tile/{z}_{x}_{y}`);
  const tile = await fetch(`${fixture.origin}/resource/tile/0_0_0`);
  assert.deepEqual(Buffer.from(await tile.arrayBuffer()), syntheticRasterTile());
  const stats = fixture.stats();
  assert.equal(stats.resourceCount, 2);
  assert.equal(stats.requests[0].receivedAuthHeader, true);
  assert.equal(stats.requests[0].cookieHeader, true);
  assert.ok(!JSON.stringify(stats).includes("synthetic-only"));
});

test("blocked style names an unresolvable external fixture but server never fetches it", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  const style = await (await fetch(`${fixture.origin}/resource/style/blocked`)).json();
  assert.equal(style.sources.t.tiles[0], "http://example.invalid:80/resource/tile/{z}_{x}_{y}");
  assert.equal(fixture.stats().resourceCount, 1);
});

test("unknown zooms, query aliases and unrelated paths are refused without resource records", async t => {
  const fixture = await createSDKFixture(); t.after(() => fixture.close());
  for (const path of ["/resource/tile/1_0_0", "/resource/style/sdk?x=1", "/resource/style/sdk/", "/resource/glyph/a", "/%72esource/style/sdk"]) {
    assert.equal((await fetch(fixture.origin + path)).status, 404);
  }
  assert.equal((await fetch(`${fixture.origin}/resource/style/sdk`, { method: "POST" })).status, 405);
  assert.equal(fixture.stats().resourceCount, 0);
  await fetch(`${fixture.origin}/reset`);
});

test("fixture rejects unapproved binds and invalid ports before listening; close is repeatable", async () => {
  for (const options of [{host:"0.0.0.0"}, {host:"8.8.8.8",allowLan:true}, {host:"192.168.1.1"}, {host:"localhost"}, {port:-1}]) await assert.rejects(createSDKFixture(options));
  const fixture = await createSDKFixture(); await fixture.close(); await fixture.close();
});

test("opt-in TLS serves a trusted HTTP/1.1 style and tile with HTTPS paths and scoped statistics", async t => {
  const fixture = await createSDKFixture({ tls: tlsMaterials() }); t.after(() => fixture.close());
  assert.ok(fixture.origin.startsWith("https://127.0.0.1:"));
  const style = await openHTTPS(fixture.origin, "/resource/style/sdk");
  assert.equal(style.alpn, "http/1.1");
  assert.ok(["TLSv1.2", "TLSv1.3"].includes(style.protocol));
  const bytes = await style.body;
  assert.equal(bytes.length, Number(style.response.headers["content-length"]));
  assert.equal(JSON.parse(bytes).sources.t.tiles[0], `${fixture.origin}/resource/tile/{z}_{x}_{y}`);
  const tile = await openHTTPS(fixture.origin, "/resource/tile/0_0_0");
  assert.deepEqual(await tile.body, syntheticRasterTile());
  const control = await openHTTPS(fixture.origin, "/stats");
  const stats = JSON.parse(await control.body);
  assert.equal(stats.resourceCount, 2);
  assert.ok(stats.requests.every(entry => entry.alpn === "http/1.1" && ["TLSv1.2", "TLSv1.3"].includes(entry.tlsProtocol)));
  assert.ok(stats.requests.every(entry => entry.receivedAuthHeader === false && entry.cookieHeader === false));
});

test("TLS held-body cancellation, release and same-path retry preserve cancelled response evidence", async t => {
  const fixture = await createSDKFixture({ tls: tlsMaterials() }); t.after(() => fixture.close());
  const path = "/resource/tile/h_2_0_0";
  const held = await openHTTPS(fixture.origin, path);
  assert.equal(fixture.stats().heldActive, 1);
  held.request.destroy(); held.request.destroy();
  await assert.rejects(held.body);
  const end = performance.now() + 1000;
  while (fixture.stats().active && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fixture.stats().active, 0);
  assert.equal(fixture.stats().requests[0].closedBeforeFinish, true);
  assert.equal(fixture.stats().requests[0].bytesWritten, 0);
  const control = await openHTTPS(fixture.origin, "/release-held");
  assert.deepEqual(JSON.parse(await control.body), { heldReleased: true, releasedOpenBodies: 0 });
  const retry = await openHTTPS(fixture.origin, path);
  assert.deepEqual(await retry.body, syntheticRasterTile());
  assert.deepEqual(fixture.stats().requests.map(entry => entry.path), [path, path]);
  assert.equal(fixture.stats().requests[0].finished, false);
  assert.equal(fixture.stats().requests[1].finished, true);
});

test("TLS refuses h2-only or absent ALPN and untrusted clients before any HTTP resource", async t => {
  const fixture = await createSDKFixture({ tls: tlsMaterials() }); t.after(() => fixture.close());
  await assert.rejects(openHTTPS(fixture.origin, "/resource/style/sdk", { ALPNProtocols: ["h2"] }));
  await assert.rejects(openHTTPS(fixture.origin, "/resource/style/sdk", { ca: undefined }));
  const target = new URL(fixture.origin);
  await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.hostname, port: Number(target.port), ca: tlsMaterials().cert }, () => {
      assert.equal(socket.alpnProtocol, false);
      socket.write("GET /resource/style/sdk HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("absent-ALPN deadline")); });
    socket.once("data", () => { socket.destroy(); reject(new Error("HTTP exposed without ALPN")); });
    socket.once("error", reject);
    socket.once("close", resolve);
  });
  assert.equal(fixture.stats().resourceCount, 0);
});

test("TLS options reject absent, oversized, malformed and extra inputs without fallback", async () => {
  const valid = tlsMaterials();
  for (const tls of [null, true, {}, { key: valid.key }, { ...valid, rejectUnauthorized: false }, { ...valid, key: valid.key.toString() }, { ...valid, cert: Buffer.alloc(16385) }, { ...valid, key: Buffer.alloc(0) }, { ...valid, cert: Buffer.from("not a certificate") }])
    await assert.rejects(createSDKFixture({ tls }));
});

test("CLI TLS file read is bounded and refuses directories, symlinks, hardlinks and oversized files", () => {
  tlsMaterials();
  assert.deepEqual(readTLSFixtureFile(join(certificateDirectory, "leaf.pem")), certificate.cert);
  const oversized = join(certificateDirectory, "oversized"), empty = join(certificateDirectory, "empty"), symlink = join(certificateDirectory, "symlink"), linked = join(certificateDirectory, "linked");
  writeFileSync(oversized, Buffer.alloc(16385)); writeFileSync(empty, Buffer.alloc(0));
  symlinkSync(join(certificateDirectory, "leaf.pem"), symlink);
  writeFileSync(linked, "synthetic"); linkSync(linked, join(certificateDirectory, "linked2"));
  for (const path of [oversized, empty, symlink, linked, certificateDirectory]) assert.throws(() => readTLSFixtureFile(path));
});

test("CLI explicit bounded TLS inputs start HTTPS without publishing key paths and shut down cleanly", async t => {
  tlsMaterials();
  const serverPath = new URL("./sdk-server.mjs", import.meta.url).pathname;
  const args = [serverPath, "--tls-key", join(certificateDirectory, "leaf.key"), "--tls-cert", join(certificateDirectory, "leaf.pem")];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const exit = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exit; });
  const ready = await new Promise((resolve, reject) => {
    let output = "", error = "";
    const timer = setTimeout(() => reject(new Error("fixture CLI readiness deadline")), 3000);
    child.stderr.on("data", bytes => { error += bytes; if (error.length > 4096) { clearTimeout(timer); reject(new Error("fixture CLI error output cap")); } });
    child.stdout.on("data", bytes => {
      output += bytes;
      if (output.length > 4096) { clearTimeout(timer); reject(new Error("fixture CLI output cap")); }
      else if (output.includes("\n")) {
        clearTimeout(timer);
        try { resolve(JSON.parse(output.trim())); } catch (cause) { reject(cause); }
      }
    });
    child.once("error", cause => { clearTimeout(timer); reject(cause); });
    child.once("close", () => { clearTimeout(timer); reject(new Error("fixture CLI exited before readiness")); });
  });
  assert.deepEqual(Object.keys(ready).sort(), ["origin", "ready", "synthetic"]);
  assert.equal(ready.ready, true); assert.equal(ready.synthetic, true);
  assert.ok(ready.origin.startsWith("https://127.0.0.1:"));
  assert.ok(!JSON.stringify(ready).includes(certificateDirectory));
  const style = await openHTTPS(ready.origin, "/resource/style/sdk");
  assert.equal(JSON.parse(await style.body).sources.t.tiles[0], ready.origin + "/resource/tile/{z}_{x}_{y}");
  child.kill("SIGTERM");
  assert.deepEqual(await exit, { code: 0, signal: null });
});
