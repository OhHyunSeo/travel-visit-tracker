import http from "node:http";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { isAllowedFixtureHost } from "./server.mjs";

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

export function syntheticRasterStyle(origin, blocked = false, multi = false) {
  return Buffer.from(JSON.stringify({
    version: 8,
    sources: { t: {
      type: "raster",
      tiles: [`${blocked ? "http://example.invalid:80" : origin}/resource/tile/{z}_{x}_{y}`],
      tileSize: 256,
      minzoom: multi ? 2 : 0,
      maxzoom: multi ? 2 : 0,
    } },
    layers: [{ id: "t", type: "raster", source: "t" }],
  }));
}

/** Actual SDK fixture, no proxy, external requests, user files or real map data. */
export async function createSDKFixture({ host = "127.0.0.1", port = 0, allowLan = false } = {}) {
  if (!isAllowedFixtureHost(host, allowLan) || host === "::1" || host === "localhost")
    throw new Error("Use a literal loopback or explicitly allowed private IPv4 address");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const tile = syntheticRasterTile();
  const requests = [], pending = new Set(), timers = new Set();
  let origin, active = 0, maxActive = 0, closed = false;
  const stats = () => ({ active, maxActive, resourceCount: requests.length, requests: requests.map(x => ({ ...x })) });
  const server = http.createServer((request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (request.method !== "GET") return json(405, { error: "GET required" });
    // Exact request targets only; no URL decoding, aliases, queries or forwarded URLs.
    if (request.url === "/stats") return json(200, stats());
    if (request.url === "/reset") {
      if (active) return json(409, { error: "Resources active" });
      requests.length = 0; maxActive = 0;
      return json(200, { reset: true });
    }
    const style = ["/resource/style/sdk", "/resource/style/multi", "/resource/style/blocked"].includes(request.url);
    const multiTile = /^\/resource\/tile\/2_[0-3]_[0-3]$/.test(request.url);
    if (!style && !multiTile && request.url !== "/resource/tile/0_0_0") return json(404, { error: "Unknown synthetic SDK resource" });
    const body = style ? syntheticRasterStyle(origin, request.url.endsWith("/blocked"), request.url.endsWith("/multi")) : tile;
    if (body.length > 256) return json(500, { error: "Synthetic reservation exceeded" });
    const entry = {
      path: request.url, bytes: body.length, bytesWritten: 0, finished: false,
      ua: request.headers["user-agent"] ?? null,
      receivedAuthHeader: request.headers.authorization !== undefined,
      cookieHeader: request.headers.cookie !== undefined,
    };
    requests.push(entry); pending.add(response);
    active++; maxActive = Math.max(maxActive, active);
    let settled = false;
    let timer;
    const settle = () => {
      if (!settled) {
        settled = true; active--; pending.delete(response);
        if (timer) { clearTimeout(timer); timers.delete(timer); }
      }
    };
    response.once("finish", () => { entry.finished = true; settle(); });
    response.once("close", settle);
    response.writeHead(200, { "Content-Type": style ? "application/json" : "image/png", "Content-Length": body.length, "Cache-Control": "no-store" });
    const sendBody = () => {
      if (settled) return;
      response.end(body);
      entry.bytesWritten = body.length; // Accepted by Node, not OS-delivered bytes.
    };
    if (multiTile) {
      response.flushHeaders();
      timer = setTimeout(() => { timers.delete(timer); sendBody(); }, 120);
      timers.add(timer);
    } else sendBody();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  origin = `http://${host}:${server.address().port}`;
  if (syntheticRasterStyle(origin).length > 256) { server.close(); throw new Error("Style exceeds fixture reservation"); }
  return {
    origin, stats,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const response of pending) response.destroy();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--allow-lan" && options.allowLan === undefined) options.allowLan = true;
    else if (["--host", "--port"].includes(key) && options[key.slice(2)] === undefined && args[index + 1] !== undefined) options[key.slice(2)] = args[++index];
    else throw new Error("Usage: sdk-server.mjs [--host IPv4] [--port 0] [--allow-lan]");
  }
  if (options.port !== undefined) options.port = Number(options.port);
  const fixture = await createSDKFixture(options);
  process.stdout.write(`${JSON.stringify({ ready: true, origin: fixture.origin, synthetic: true })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
