import http from "node:http";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { isIP } from "node:net";

const kinds = new Set(["style", "tile", "glyph", "sprite"]);
const knownQuery = new Set([
  "bytes",
  "delayMs",
  "status",
  "chunked",
  "gzip",
  "redirect",
  "hold",
]);
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

function integerQuery(params, name, fallback, min, max) {
  const value = params.get(name);
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`Invalid ${name}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`Invalid ${name}`);
  return number;
}

function flagQuery(params, name) {
  const value = params.get(name);
  if (value === null || value === "0") return false;
  if (value !== "1") throw new Error(`Invalid ${name}`);
  return true;
}

/**
 * Synthetic HTTP only. No provider requests, personal files or credential values.
 * bytesWritten counts payload accepted by response.write(), not OS-delivered/wire bytes.
 */
export function isAllowedFixtureHost(host, allowLan = false) {
  if (typeof host !== "string") return false;
  if (loopbackHosts.has(host)) return true;
  if (allowLan !== true || isIP(host) !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export async function createMapFixture({
  host = "127.0.0.1",
  port = 0,
  allowLan = false,
} = {}) {
  if (!isAllowedFixtureHost(host, allowLan))
    throw new Error(
      "Fixture must bind loopback or an explicitly allowed private LAN IPv4 address",
    );
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port");
  let active = 0;
  let maxActive = 0;
  let nextId = 1;
  let rejectedCount = 0;
  let nonControlRequestCount = 0;
  let invalidRouteCount = 0;
  let invalidQueryCount = 0;
  const requests = [];
  const held = new Set();
  const pending = new Set();
  const timers = new Set();
  let closed = false;

  const stats = () => ({
    active,
    maxActive,
    resourceCount: requests.length,
    rejectedCount,
    nonControlRequestCount,
    invalidRouteCount,
    invalidQueryCount,
    totalBytesWritten: requests.reduce(
      (total, request) => total + request.bytesWritten,
      0,
    ),
    requests: requests.map((request) => ({ ...request })),
  });
  const reset = () => {
    if (active !== 0)
      throw new Error("Cannot reset while resources are active");
    maxActive = 0;
    nextId = 1;
    rejectedCount = 0;
    nonControlRequestCount = 0;
    invalidRouteCount = 0;
    invalidQueryCount = 0;
    requests.length = 0;
  };
  const release = () => {
    const ready = [...held];
    held.clear();
    ready.forEach((start) => start());
    return ready.length;
  };
  const later = (callback, milliseconds) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, milliseconds);
    timers.add(timer);
    return timer;
  };
  const json = (response, status, body) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  };

  const server = http.createServer((request, response) => {
    let url;
    try {
      url = new URL(request.url, "http://fixture.invalid");
    } catch {
      rejectedCount++;
      nonControlRequestCount++;
      invalidRouteCount++;
      json(response, 400, { error: "Invalid URL" });
      return;
    }
    if (!["/stats", "/reset", "/release"].includes(url.pathname))
      nonControlRequestCount++;
    if (request.method !== "GET") {
      rejectedCount++;
      json(response, 405, { error: "GET required" });
      return;
    }
    if (url.pathname === "/stats") return json(response, 200, stats());
    if (url.pathname === "/release")
      return json(response, 200, { released: release() });
    if (url.pathname === "/reset") {
      try {
        reset();
        return json(response, 200, { reset: true });
      } catch {
        return json(response, 409, { error: "Active resources" });
      }
    }
    const match = /^\/resource\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/.exec(
      url.pathname,
    );
    if (!match || !kinds.has(match[1])) {
      rejectedCount++;
      invalidRouteCount++;
      return json(response, 404, { error: "Unknown fixture resource" });
    }
    let options;
    try {
      for (const key of url.searchParams.keys()) {
        if (!knownQuery.has(key) || url.searchParams.getAll(key).length !== 1)
          throw new Error("Unknown or duplicate option");
      }
      options = {
        bytes: integerQuery(url.searchParams, "bytes", 64, 0, 65_536),
        delayMs: integerQuery(url.searchParams, "delayMs", 100, 0, 2_000),
        status: integerQuery(url.searchParams, "status", 200, 200, 599),
        chunked: flagQuery(url.searchParams, "chunked"),
        gzip: flagQuery(url.searchParams, "gzip"),
        redirect: flagQuery(url.searchParams, "redirect"),
        hold: flagQuery(url.searchParams, "hold"),
      };
      if ([204, 205, 304].includes(options.status))
        throw new Error("Bodyless status unsupported");
    } catch {
      rejectedCount++;
      invalidQueryCount++;
      return json(response, 400, { error: "Invalid fixture options" });
    }
    const entry = {
      id: nextId++,
      resourceId: match[2],
      kind: match[1],
      path: url.pathname,
      ua:
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"]
          : null,
      receivedAuthHeader: request.headers.authorization !== undefined,
      cookieHeader: request.headers.cookie !== undefined,
      bytesWritten: 0,
      decodedBodyBytes: options.bytes,
      gzip: options.gzip,
      chunked: options.chunked,
      finished: false,
      aborted: false,
    };
    requests.push(entry);
    active++;
    maxActive = Math.max(maxActive, active);
    pending.add(response);
    const localTimers = new Set();
    let settled = false;
    let start;
    const settle = (aborted) => {
      if (settled) return;
      settled = true;
      entry.finished = !aborted;
      entry.aborted = aborted;
      active--;
      pending.delete(response);
      held.delete(start);
      for (const timer of localTimers) {
        clearTimeout(timer);
        timers.delete(timer);
      }
      localTimers.clear();
    };
    response.once("error", () => settle(true));
    response.once("finish", () => settle(false));
    response.once("close", () => settle(!response.writableFinished));
    const schedule = (callback) => {
      const timer = later(() => {
        localTimers.delete(timer);
        if (!settled && !response.destroyed) callback();
      }, options.delayMs);
      localTimers.add(timer);
    };
    const write = (part) => {
      if (settled || response.destroyed) return false;
      entry.bytesWritten += part.byteLength;
      response.write(part);
      return true;
    };
    start = () => {
      if (settled || closed) return;
      schedule(() => {
        const decoded = Buffer.alloc(options.bytes, 0x61);
        const body = options.gzip ? gzipSync(decoded) : decoded;
        const headers = {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        };
        if (!options.chunked)
          headers["Content-Length"] = String(body.byteLength);
        if (options.gzip) headers["Content-Encoding"] = "gzip";
        if (options.redirect)
          headers.Location = "http://example.invalid/fixture-target";
        response.writeHead(options.redirect ? 302 : options.status, headers);
        response.flushHeaders();
        if (body.byteLength === 0) return response.end();
        const split = Math.max(1, Math.ceil(body.byteLength / 2));
        if (!write(body.subarray(0, split))) return;
        if (split === body.byteLength) return response.end();
        schedule(() => {
          write(body.subarray(split));
          if (!settled && !response.destroyed) response.end();
        });
      });
    };
    if (options.hold) held.add(start);
    else start();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const origin = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
  const close = async () => {
    if (closed) return;
    closed = true;
    held.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const response of pending) response.destroy();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  };
  return { origin, stats, reset, release, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--allow-lan" && options.allowLan === undefined)
      options.allowLan = true;
    else if (
      ["--host", "--port"].includes(key) &&
      options[key.slice(2)] === undefined &&
      args[index + 1] !== undefined
    )
      options[key.slice(2)] = args[++index];
    else
      throw new Error(
        "Usage: node server.mjs [--host 127.0.0.1] [--port 0] [--allow-lan]",
      );
  }
  const fixture = await createMapFixture({
    host: options.host,
    port: options.port === undefined ? 0 : Number(options.port),
    allowLan: options.allowLan,
  });
  process.stdout.write(
    `${JSON.stringify({ ready: true, origin: fixture.origin, synthetic: true })}\n`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await fixture.close();
      process.exit(0);
    });
}
