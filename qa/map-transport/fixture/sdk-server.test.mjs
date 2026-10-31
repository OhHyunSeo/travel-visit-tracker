import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { createSDKFixture, syntheticRasterStyle, syntheticRasterTile } from "./sdk-server.mjs";

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

test("style fits reservation at longest supported IPv4 origin with one zoom-zero raster source", () => {
  for (const [blocked, multi] of [[false, false], [true, false], [false, true]]) {
    const bytes = syntheticRasterStyle("http://192.168.255.255:65535", blocked, multi);
    assert.ok(bytes.length <= 256);
    const style = JSON.parse(bytes);
    assert.equal(style.version, 8);
    assert.equal(style.sources.t.maxzoom, multi ? 2 : 0);
    assert.equal(style.sources.t.minzoom, multi ? 2 : 0);
    assert.equal(style.sources.t.tileSize, 256);
    assert.equal(style.layers[0].type, "raster");
    assert.equal(style.sources.t.tiles[0].includes("example.invalid"), blocked);
  }
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
