import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createMapFixture, isAllowedFixtureHost } from "./server.mjs";

function pendingRequest(url, headers = {}) {
  const request = httpRequest(url, { agent: false, headers });
  const result = new Promise((resolve, reject) => {
    request.once("error", reject);
    request.once("response", (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.once("error", reject);
      response.once("end", () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(parts),
        }),
      );
    });
  });
  result.catch(() => {});
  request.end();
  return { request, result };
}
const raw = (url, headers) => pendingRequest(url, headers).result;
async function waitUntil(predicate) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Fixture condition timed out");
    await delay(5);
  }
}
async function withFixture(run) {
  const fixture = await createMapFixture();
  try {
    await run(fixture);
  } finally {
    await fixture.close();
  }
}

test(
  "records overlapping resource lifetimes through delayed body completion",
  { timeout: 5_000 },
  async () => {
    await withFixture(async (fixture) => {
      const work = Array.from({ length: 8 }, (_, index) =>
        raw(
          `${fixture.origin}/resource/${["style", "tile", "glyph", "sprite"][index % 4]}/r${index}?delayMs=60`,
          { "User-Agent": "TripPaintingFixture/1.0" },
        ),
      );
      await waitUntil(() => fixture.stats().active === 8);
      assert.equal(fixture.stats().maxActive, 8);
      await waitUntil(() => fixture.stats().totalBytesWritten > 0);
      assert.equal(
        fixture.stats().active,
        8,
        "headers/first body chunk do not finish a resource",
      );
      assert.equal(
        fixture
          .stats()
          .requests.some((r) => !r.finished && r.bytesWritten === 32),
        true,
      );
      const results = await Promise.all(work);
      assert.equal(
        results.every(
          (r) => r.status === 200 && r.body.equals(Buffer.alloc(64, 0x61)),
        ),
        true,
      );
      const stats = fixture.stats();
      assert.equal(stats.active, 0);
      assert.equal(stats.resourceCount, 8);
      assert.equal(stats.nonControlRequestCount, 8);
      assert.equal(stats.invalidRouteCount, 0);
      assert.equal(stats.invalidQueryCount, 0);
      assert.equal(stats.totalBytesWritten, 512);
      assert.equal(
        stats.requests.every(
          (r) => r.finished && !r.aborted && r.ua === "TripPaintingFixture/1.0",
        ),
        true,
      );
      stats.requests[0].bytesWritten = -1;
      assert.equal(
        fixture.stats().requests[0].bytesWritten,
        64,
        "snapshots do not mutate counters",
      );
    });
  },
);

test(
  "holds requests, refuses active reset and releases only currently held work",
  { timeout: 5_000 },
  async () => {
    await withFixture(async (fixture) => {
      const work = raw(`${fixture.origin}/resource/tile/held?hold=1&delayMs=0`);
      await waitUntil(() => fixture.stats().active === 1);
      assert.equal(fixture.stats().totalBytesWritten, 0);
      assert.throws(() => fixture.reset(), /active/);
      assert.equal((await raw(`${fixture.origin}/reset`)).status, 409);
      const released = await raw(`${fixture.origin}/release`);
      assert.deepEqual(JSON.parse(released.body), { released: 1 });
      assert.equal((await work).body.length, 64);
      assert.equal(fixture.release(), 0);
      const reset = await raw(`${fixture.origin}/reset`);
      assert.deepEqual(JSON.parse(reset.body), { reset: true });
      assert.equal(fixture.stats().resourceCount, 0);
      assert.equal(fixture.stats().maxActive, 0);
      assert.equal(fixture.stats().nonControlRequestCount, 0);
      assert.equal(fixture.stats().invalidRouteCount, 0);
      assert.equal(fixture.stats().invalidQueryCount, 0);
    });
  },
);

test("reports compressed payload separately from decoded synthetic body", async () => {
  await withFixture(async (fixture) => {
    const response = await raw(
      `${fixture.origin}/resource/glyph/compressed?bytes=4096&gzip=1&chunked=1&delayMs=0`,
    );
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.equal(response.headers["content-length"], undefined);
    assert.equal(response.headers["transfer-encoding"], "chunked");
    assert.equal(
      gunzipSync(response.body).equals(Buffer.alloc(4096, 0x61)),
      true,
    );
    assert.equal(response.body.length < 4096, true);
    const stats = fixture.stats();
    assert.equal(stats.requests[0].decodedBodyBytes, 4096);
    assert.equal(stats.requests[0].bytesWritten, response.body.length);
    assert.equal(stats.totalBytesWritten, response.body.length);
  });
});

test("redirect fixture does not follow or contact another host itself", async () => {
  await withFixture(async (fixture) => {
    const response = await raw(
      `${fixture.origin}/resource/style/redirect?redirect=1&delayMs=0`,
    );
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.location,
      "http://example.invalid/fixture-target",
    );
    assert.equal(response.body.length, 64);
    assert.equal(fixture.stats().resourceCount, 1);
    assert.equal(fixture.stats().active, 0);
  });
});

test("records credential header presence without retaining credential values", async () => {
  await withFixture(async (fixture) => {
    const response = await raw(
      `${fixture.origin}/resource/sprite/headers?delayMs=0`,
      {
        Authorization: "synthetic-secret-authorization",
        Cookie: "synthetic-secret-cookie",
      },
    );
    assert.equal(response.status, 200);
    const entry = fixture.stats().requests[0];
    assert.equal(entry.receivedAuthHeader, true);
    assert.equal(entry.cookieHeader, true);
    assert.equal(
      JSON.stringify(fixture.stats()).includes("synthetic-secret"),
      false,
    );
    assert.equal(entry.path, "/resource/sprite/headers");
  });
});

test("bounds fixture options and rejects unknown paths, duplicate options and bodyless statuses", async () => {
  await withFixture(async (fixture) => {
    for (const path of [
      "/resource/tile/invalid?bytes=65537",
      "/resource/tile/invalid?bytes=-1",
      "/resource/tile/invalid?delayMs=2001",
      "/resource/tile/invalid?bytes=01",
      "/resource/tile/invalid?bytes=1&bytes=2",
      "/resource/tile/invalid?unrecognized=1",
      "/resource/tile/invalid?status=204",
      "/resource/tile/invalid?status=304",
      "/resource/tile/invalid?gzip=yes",
    ])
      assert.equal((await raw(`${fixture.origin}${path}`)).status, 400, path);
    assert.equal(
      (await raw(`${fixture.origin}/resource/unknown/invalid`)).status,
      404,
    );
    assert.equal(fixture.stats().resourceCount, 0);
    assert.equal(fixture.stats().rejectedCount, 10);
    assert.equal(fixture.stats().nonControlRequestCount, 10);
    assert.equal(fixture.stats().invalidRouteCount, 1);
    assert.equal(fixture.stats().invalidQueryCount, 9);
    assert.equal(
      (await raw(`${fixture.origin}/resource/tile/empty?bytes=0&delayMs=0`))
        .body.length,
      0,
    );
    assert.equal(
      (
        await raw(
          `${fixture.origin}/resource/tile/max?bytes=65536&status=503&delayMs=0`,
        )
      ).body.length,
      65_536,
    );
    assert.equal(
      (await raw(`${fixture.origin}/resource/tile/single?bytes=1&delayMs=20`))
        .body.length,
      1,
    );
    assert.equal(
      fixture.stats().active,
      0,
      "no artificial delayed tail after the sole byte",
    );
    assert.equal(fixture.stats().resourceCount, 3);
  });
});

test(
  "cancelled held resource is marked once and no longer released",
  { timeout: 5_000 },
  async () => {
    await withFixture(async (fixture) => {
      const pending = pendingRequest(
        `${fixture.origin}/resource/tile/cancelled?hold=1`,
      );
      const rejection = assert.rejects(pending.result);
      await waitUntil(() => fixture.stats().active === 1);
      pending.request.destroy(new Error("Synthetic client cancellation"));
      await rejection;
      await waitUntil(() => fixture.stats().active === 0);
      assert.equal(fixture.release(), 0);
      assert.equal(fixture.stats().requests[0].aborted, true);
      assert.equal(fixture.stats().requests[0].finished, false);
      assert.equal(fixture.stats().totalBytesWritten, 0);
    });
  },
);

test(
  "close cancels owned held connections and can be called twice",
  { timeout: 5_000 },
  async () => {
    const fixture = await createMapFixture();
    const pending = pendingRequest(
      `${fixture.origin}/resource/tile/close?hold=1`,
    );
    const rejection = assert.rejects(pending.result);
    await waitUntil(() => fixture.stats().active === 1);
    await fixture.close();
    await rejection;
    await waitUntil(() => fixture.stats().active === 0);
    await fixture.close();
    assert.equal(fixture.stats().requests[0].aborted, true);
  },
);

test("refuses non-loopback bind and invalid port before listening", async () => {
  await assert.rejects(createMapFixture({ host: "0.0.0.0" }), /loopback/);
  await assert.rejects(
    createMapFixture({ host: "example.invalid" }),
    /loopback/,
  );
  await assert.rejects(createMapFixture({ port: -1 }), /port/);
  await assert.rejects(createMapFixture({ port: 1.5 }), /port/);
});

test("explicit LAN opt-in permits only literal private IPv4 addresses", async () => {
  for (const host of [
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
  ]) {
    assert.equal(isAllowedFixtureHost(host), false, host);
    assert.equal(isAllowedFixtureHost(host, true), true, host);
    await assert.rejects(createMapFixture({ host }), /explicitly allowed/);
  }
  for (const host of [
    "0.0.0.0",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "10.256.0.1",
    "010.0.0.1",
    "device.local",
    "::",
  ])
    assert.equal(isAllowedFixtureHost(host, true), false, host);
  assert.equal(isAllowedFixtureHost("127.0.0.1"), true);
  assert.equal(isAllowedFixtureHost("::1"), true);
});

test(
  "CLI emits ready JSON and closes on SIGTERM",
  { timeout: 5_000 },
  async () => {
    const child = spawn(
      process.execPath,
      [new URL("./server.mjs", import.meta.url).pathname, "--port", "0"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      const firstOutput = await Promise.race([
        once(child.stdout, "data").then(([part]) => part.toString()),
        once(child, "exit").then(() => {
          throw new Error("Fixture CLI exited before ready");
        }),
      ]);
      const ready = JSON.parse(firstOutput.trim());
      assert.equal(ready.ready, true);
      assert.equal(ready.synthetic, true);
      assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
      assert.equal((await raw(`${ready.origin}/stats`)).status, 200);
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      assert.deepEqual(await exited, [0, null]);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  },
);
