import http from "node:http";
import https from "node:https";
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { isAllowedFixtureHost } from "./server.mjs";

const maxTLSFileBytes = 16384;

// CLI input is read once, before listening. No private key or certificate paths
// are exposed in the ready record, HTTP routes or resource statistics.
export function readTLSFixtureFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maxTLSFileBytes))
      throw new Error("TLS fixture input must be a bounded, singly linked regular file");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (size !== Number(before.size) || ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key => before[key] !== after[key]))
      throw new Error("TLS fixture input changed during bounded read");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

function fixtureTLSOptions(value) {
  if (value === undefined) return null;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(",") !== "cert,key"
      || ![value.key, value.cert].every(bytes => Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxTLSFileBytes))
    throw new Error("TLS fixture requires only bounded key and certificate buffers");
  return { key: Buffer.from(value.key), cert: Buffer.from(value.cert), minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"] };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, body) {
  const type = Buffer.from(name, "ascii");
  const output = Buffer.alloc(body.length + 12);
  output.writeUInt32BE(body.length);
  type.copy(output, 4);
  body.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, body])), output.length - 4);
  return output;
}

// An original 256px indexed green tile, under the existing 256-byte reservation.
export function syntheticRasterTile() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 1;
  header[9] = 3;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from([25, 170, 80, 25, 170, 80])),
    chunk("IDAT", deflateSync(Buffer.alloc(33 * 256))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function syntheticRasterStyle(origin, blocked = false, multi = false, held = false) {
  return Buffer.from(JSON.stringify({
    version: 8,
    sources: { t: {
      type: "raster",
      tiles: [`${blocked ? "http://example.invalid:80" : origin}/resource/tile/${held ? "h_" : ""}{z}_{x}_{y}`],
      tileSize: 256,
      minzoom: multi || held ? 2 : 0,
      maxzoom: multi || held ? 2 : 0,
    } },
    layers: [{ id: "t", type: "raster", source: "t" }],
  }));
}

const mixedFontStack = 'Noto Sans Regular';

export function syntheticMixedStyle(origin, fontStack = 'QA') {
  return Buffer.from(JSON.stringify({
    version: 8,
    glyphs: `${origin}/resource/glyph/{fontstack}/{range}.pbf`,
    sprite: `${origin}/resource/sprite/mixed`,
    sources: {
      t: { type: "raster", tiles: [`${origin}/resource/tile/m_{z}_{x}_{y}`], tileSize: 256, minzoom: 2, maxzoom: 2 },
      p: { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } } },
    },
    layers: [
      { id: "t", type: "raster", source: "t" },
      { id: "s", type: "symbol", source: "p", layout: { "icon-image": "mark", "text-field": "A", "text-font": [fontStack] } },
    ],
  }));
}

function syntheticPolicyStyle(origin, target) {
  const templates = {
    t: `${origin}/resource/tile/m_2_0_{y}`,
    p: `${origin}/resource/tile/denied_{z}_{x}_{y}`,
    h: `${target}/resource/tile/m_2_0_{y}`,
  };
  const sources = Object.fromEntries(Object.entries(templates).map(([id, path]) =>
    [id, { type: "raster", tiles: [path], tileSize: 256, minzoom: 0, maxzoom: 0 }]));
  return Buffer.from(JSON.stringify({ version: 8, sources,
    layers: Object.keys(sources).map(id => ({ id, type: "raster", source: id })) }));
}

function spriteImage(ratio) {
  const size = 8 * ratio;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = 1 + size * 4;
  const pixels = Buffer.alloc(stride * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x - center) + Math.abs(y - center) <= center)
        pixels.set([255, 155, 40, 255], y * stride + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function varint(value) {
  const bytes = [];
  while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; }
  bytes.push(value);
  return Buffer.from(bytes);
}

function protoBytes(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
}

function protoNumber(field, value) {
  return Buffer.concat([varint(field << 3), varint(value)]);
}

// Original synthetic A. The glyph metrics exclude the implicit 3px bitmap border.
// https://github.com/mapbox/fontnik/blob/master/proto/glyphs.proto
// https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/src/mln/text/glyph_pbf.cpp
function syntheticGlyph(fontStack) {
  const mask = ["01110", "10001", "10001", "11111", "10001", "10001", "10001"];
  const width = mask[0].length, height = mask.length, border = 3;
  const stride = width + 2 * border, rows = height + 2 * border;
  const ink = (x, y) => mask[y - border]?.[x - border] === "1";
  const bitmap = Buffer.alloc(stride * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < stride; x++) {
      let distance = 4;
      for (let yy = 0; yy < rows; yy++) {
        for (let xx = 0; xx < stride; xx++) {
          if (ink(x, y) !== ink(xx, yy)) distance = Math.min(distance, Math.hypot(x - xx, y - yy));
        }
      }
      const signed = (ink(x, y) ? 1 : -1) * (distance - 0.5);
      bitmap[y * stride + x] = Math.max(0, Math.min(255, Math.round(192 + 48 * signed)));
    }
  }
  const glyph = Buffer.concat([
    protoNumber(1, 65), protoBytes(2, bitmap), protoNumber(3, width), protoNumber(4, height),
    protoNumber(5, 0), protoNumber(6, 2 * height), protoNumber(7, width + 1), // ZigZag left=0, top=height.
  ]);
  const stack = Buffer.concat([protoBytes(1, fontStack), protoBytes(2, "0-255"), protoBytes(3, glyph)]);
  return protoBytes(1, stack);
}

function mixedAssetBodies(fontStack) {
  const glyphPath = `/resource/glyph/${encodeURIComponent(fontStack)}/0-255.pbf`;
  const assets = new Map([[glyphPath, { body: syntheticGlyph(fontStack), type: "application/x-protobuf", hold: true }]]);
  for (const ratio of [1, 2]) {
    const base = `/resource/sprite/mixed${ratio === 1 ? "" : "@2x"}`;
    const size = 8 * ratio;
    const index = { mark: { width: size, height: size, x: 0, y: 0, pixelRatio: ratio } };
    assets.set(`${base}.json`, { body: Buffer.from(JSON.stringify(index)), type: "application/json" });
    assets.set(`${base}.png`, { body: spriteImage(ratio), type: "image/png" });
  }
  return assets;
}

/** Actual SDK fixture, no proxy, external requests, user files or real map data. */
export async function createSDKFixture({ host = "127.0.0.1", port = 0, allowLan = false, tls, mixed = false, encodedGlyph = false, policyTarget } = {}) {
  if (!isAllowedFixtureHost(host, allowLan) || host === "::1" || host === "localhost")
    throw new Error("Use a literal loopback or explicitly allowed private IPv4 address");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const tlsOptions = fixtureTLSOptions(tls);
  if (typeof mixed !== "boolean" || (mixed && !tlsOptions)) throw new Error("Mixed SDK fixture requires explicit TLS");
  if (typeof encodedGlyph !== "boolean" || (encodedGlyph && (!mixed || policyTarget !== undefined)))
    throw new Error("Encoded glyphs require the mixed SDK fixture without a policy target");
  if (policyTarget !== undefined) {
    const target = new URL(policyTarget);
    if (!mixed || !tlsOptions || target.protocol !== "https:" || target.hostname !== host || !target.port || target.origin !== policyTarget || Number(target.port) === port)
      throw new Error("Policy fixture requires a distinct HTTPS port on the same private address");
  }
  const tile = syntheticRasterTile();
  const fontStack = encodedGlyph ? mixedFontStack : "QA";
  const mixedAssets = mixed ? mixedAssetBodies(fontStack) : new Map();
  const requests = [], pending = new Set(), timers = new Set(), heldBodies = new Map();
  let origin, active = 0, maxActive = 0, closed = false, heldReleased = false;
  let policyDeniedPathArrivals = 0;
  const stats = () => ({ active, maxActive, heldActive: heldBodies.size, heldReleased, resourceCount: requests.length, requests: requests.map(x => ({ ...x })),
    ...(policyTarget ? { policyDeniedPathArrivals } : {}) });
  const handler = (request, response) => {
    // https installs its own secureConnection listener before ours. Check again
    // at the handler boundary so already-buffered HTTP cannot reach any route.
    if (tlsOptions && request.socket.alpnProtocol !== "http/1.1") { request.socket.destroy(); return; }
    const json = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (request.method !== "GET") return json(405, { error: "GET required" });
    // Exact request targets only; no URL decoding, aliases, queries or forwarded URLs.
    if (request.url === "/stats") return json(200, stats());
    // Out-of-band QA control, not a provider resource or budgeted SDK request.
    if (request.url === "/release-held") {
      heldReleased = true;
      const release = [...heldBodies.values()];
      for (const sendBody of release) sendBody();
      return json(200, { heldReleased, releasedOpenBodies: release.length });
    }
    if (request.url === "/reset") {
      if (active) return json(409, { error: "Resources active" });
      requests.length = 0; maxActive = 0; heldReleased = false; policyDeniedPathArrivals = 0;
      return json(200, { reset: true });
    }
    if (policyTarget && request.url === "/resource/tile/denied_0_0_0") {
      policyDeniedPathArrivals++;
      return json(404, { error: "Policy path reached the fixture" });
    }
    const mixedStyle = mixed && request.url === "/resource/style/mixed";
    const style = mixedStyle || ["/resource/style/sdk", "/resource/style/multi", "/resource/style/blocked", "/resource/style/held", "/resource/style/empty"].includes(request.url);
    const multiTile = /^\/resource\/tile\/2_[0-3]_[0-3]$/.test(request.url);
    const heldTile = /^\/resource\/tile\/h_2_[0-3]_[0-3]$/.test(request.url);
    const mixedTile = mixed && /^\/resource\/tile\/m_2_[0-3]_[0-3]$/.test(request.url);
    const asset = mixedAssets.get(request.url);
    if (!style && !multiTile && !heldTile && !mixedTile && !asset && request.url !== "/resource/tile/0_0_0") return json(404, { error: "Unknown synthetic SDK resource" });
    const redirect = policyTarget && request.url === "/resource/tile/m_2_0_0";
    const body = redirect ? Buffer.alloc(0)
      : mixedStyle ? (policyTarget ? syntheticPolicyStyle(origin, policyTarget) : syntheticMixedStyle(origin, fontStack))
      : request.url === "/resource/style/empty" ? Buffer.from('{"version":8,"sources":{},"layers":[]}')
      : style ? syntheticRasterStyle(origin, request.url.endsWith("/blocked"), request.url.endsWith("/multi"), request.url.endsWith("/held")) : (asset?.body ?? tile);
    if (body.length > (mixedStyle ? 1024 : 256)) return json(500, { error: "Synthetic reservation exceeded" });
    // Sprite documents finish before the barrier so SDK style loading cannot deadlock on them.
    const hold = !redirect && (heldTile || mixedTile || asset?.hold === true);
    const entry = {
      path: request.url, bytes: body.length, bytesWritten: 0, finished: false,
      held: hold, closedBeforeFinish: false,
      ua: request.headers["user-agent"] ?? null,
      receivedAuthHeader: request.headers.authorization !== undefined,
      cookieHeader: request.headers.cookie !== undefined,
      ...(policyTarget ? { status: redirect ? 302 : 200 } : {}),
      ...(tlsOptions ? { tlsProtocol: request.socket.getProtocol(), alpn: request.socket.alpnProtocol } : {}),
    };
    requests.push(entry); pending.add(response);
    active++; maxActive = Math.max(maxActive, active);
    let settled = false;
    let timer;
    const settle = () => {
      if (!settled) {
        settled = true; active--; pending.delete(response); heldBodies.delete(response);
        if (timer) { clearTimeout(timer); timers.delete(timer); }
      }
    };
    response.once("finish", () => { entry.finished = true; settle(); });
    response.once("close", () => { entry.closedBeforeFinish = !entry.finished; settle(); });
    const type = style ? "application/json" : (asset?.type ?? "image/png");
    response.writeHead(redirect ? 302 : 200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store",
      ...(redirect ? { Location: `${policyTarget}/resource/tile/m_2_0_1` } : {}) });
    const sendBody = () => {
      if (settled || response.destroyed) return;
      heldBodies.delete(response);
      response.end(body);
      entry.bytesWritten = body.length; // Accepted by Node, not OS-delivered bytes.
    };
    if (hold && !heldReleased) {
      response.flushHeaders();
      heldBodies.set(response, sendBody);
    } else if (multiTile) {
      response.flushHeaders();
      // Keep the existing HTTP window; TLS handshakes and the SDK main-thread
      // observer need a larger, still bounded window to see four open bodies.
      timer = setTimeout(() => { timers.delete(timer); sendBody(); }, tlsOptions ? 500 : 120);
      timers.add(timer);
    } else sendBody();
  };
  // TLS is an explicit separate fixture mode; invalid TLS never falls back to HTTP.
  const server = tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler);
  const sockets = new Set();
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  if (tlsOptions) server.on("secureConnection", socket => {
    if (socket.alpnProtocol !== "http/1.1") socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  origin = `${tlsOptions ? "https" : "http"}://${host}:${server.address().port}`;
  if (origin === policyTarget || syntheticRasterStyle(origin).length > 256 ||
      (policyTarget && syntheticPolicyStyle(origin, policyTarget).length > 1024)) {
    server.close();
    throw new Error("Policy target or style reservation is invalid");
  }
  return {
    origin, stats,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      heldBodies.clear();
      for (const response of pending) response.destroy();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--allow-lan" && options.allowLan === undefined) options.allowLan = true;
    else if (key === "--mixed" && options.mixed === undefined) options.mixed = true;
    else if (key === "--encoded-glyph" && options.encodedGlyph === undefined) options.encodedGlyph = true;
    else if (key === "--policy-target" && options.policyTarget === undefined && args[index + 1] !== undefined) options.policyTarget = args[++index];
    else if (["--host", "--port", "--tls-key", "--tls-cert"].includes(key) && options[key.slice(2)] === undefined && args[index + 1] !== undefined) options[key.slice(2)] = args[++index];
    else throw new Error("Usage: sdk-server.mjs [--host IPv4] [--port 0] [--allow-lan] [--tls-key PATH --tls-cert PATH] [--mixed] [--encoded-glyph] [--policy-target HTTPS_ORIGIN]");
  }
  if (options.port !== undefined) options.port = Number(options.port);
  if ((options["tls-key"] !== undefined) !== (options["tls-cert"] !== undefined)) throw new Error("Both TLS fixture input paths are required");
  if (options["tls-key"] !== undefined) {
    options.tls = { key: readTLSFixtureFile(options["tls-key"]), cert: readTLSFixtureFile(options["tls-cert"]) };
    delete options["tls-key"]; delete options["tls-cert"];
  }
  const fixture = await createSDKFixture(options);
  process.stdout.write(`${JSON.stringify({ ready: true, origin: fixture.origin, synthetic: true })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
