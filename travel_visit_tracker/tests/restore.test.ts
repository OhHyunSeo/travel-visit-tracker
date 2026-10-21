import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestoreCoordinator } from '../src/services/restore';
import { RestoreClient, RestoreFileError } from '../src/services/restoreSync';
import type { RemotePhoto, RemoteVisit } from '../src/storage/restore';
import { bytes, epoch, fixture, owner, session, visit, photo } from './restoreFixture';
let f: Awaited<ReturnType<typeof fixture>>;
let latest = { ...session },
  active = true,
  interrupt: () => void;
let visits: RemoteVisit[], photos: RemotePhoto[];
let failDownload = false;
const send = vi.fn<typeof fetch>();
const disposals = vi.fn();
const stage = vi.fn(async (p: RemotePhoto, b: Uint8Array) => {
  if (createHash('sha256').update(b).digest('hex') !== p.sha256)
    throw new RestoreFileError('invalid');
  return {
    uri: `visit-photos/restored-${randomUUID()}.png`,
    dispose: async (keep: boolean) => {
      disposals(keep);
    },
  };
});
let coordinator: RestoreCoordinator;
const consent = { ownerId: owner, token: session.token! };
function serve(list: { revision: number }[], after: number, key: string) {
  const items = list.filter((x) => x.revision > after).slice(0, 100);
  return new Response(
    JSON.stringify({
      [key]: items,
      cursor: items.at(-1)?.revision ?? after,
      hasMore: list.filter((x) => x.revision > after).length > 100,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  f = await fixture();
  latest = { ...session };
  active = true;
  failDownload = false;
  const v = visit();
  visits = [v];
  photos = [photo(v)];
  send.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const after = Number(url.searchParams.get('after'));
    if (url.pathname === '/api/visits') return serve(visits, after, 'visits');
    if (url.pathname === '/api/visit-photos') return serve(photos, after, 'photos');
    if (failDownload) {
      failDownload = false;
      throw Error('connection lost');
    }
    return new Response(Uint8Array.from(bytes), {
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
    });
  });
  coordinator = new RestoreCoordinator(
    () => latest,
    async () => f.repo,
    new RestoreClient(send),
    stage,
    () => active,
    (stop) => {
      interrupt = stop;
      return () => {};
    },
  );
});
afterEach(() => f.close());
describe('manual restoration coordinator', () => {
  it('gets visits before photos, checks file bytes, and skips every file on a repeated run', async () => {
    expect(await coordinator.run(consent)).toMatchObject({
      downloaded: 1,
      pending: 0,
      paused: false,
    });
    expect(send.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual([
      '/api/visits',
      '/api/visit-photos',
      photos[0].originalPath,
    ]);
    expect(disposals).toHaveBeenCalledWith(true);
    expect((await f.repo.snapshot(false)).photos).toHaveLength(1);
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 0 });
    expect(stage).toHaveBeenCalledTimes(1);
  });
  it('persists discovery and resumes after an interrupted download without advancing the scan', async () => {
    failDownload = true;
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 1 });
    expect(await f.repo.restoration.state()).toMatchObject({
      visitCursor: 1,
      photoCursor: 1,
      photoScan: 0,
    });
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 0 });
  });
  it('limits new files to 20 and resumes the remainder on the next explicit run', async () => {
    photos = Array.from({ length: 21 }, (_, i) => photo(visits[0], { revision: i + 1 }));
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 20, pending: 1 });
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 0 });
    expect(stage).toHaveBeenCalledTimes(21);
  });
  it('retains invalid bytes in the queue while allowing a later valid photo to progress', async () => {
    const good = photo(visits[0], { revision: 2 });
    photos[0].sha256 = 'f'.repeat(64);
    photos.push(good);
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 1 });
    expect(await f.repo.restoration.state()).toMatchObject({ blocked: 1, photoScan: 2 });
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 1 });
  });
  it('does not let unknown parents at the start of the queue starve later photos', async () => {
    const unknown = visit();
    photos = Array.from({ length: 101 }, (_, i) => photo(unknown, { revision: i + 1 }));
    photos.push(photo(visits[0], { revision: 102 }));
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 101 });
    expect(await f.repo.restoration.state()).toMatchObject({ blocked: 101 });
  });
  it.each(['account', 'token', 'background'])(
    'does not stage downloaded data after %s changes',
    async (kind) => {
      const original = send.getMockImplementation()!;
      send.mockImplementation(async (...args) => {
        const response = await original(...args);
        if (String(args[0]).endsWith('/original')) {
          if (kind === 'account') latest = { ...session, user: { ...session.user, id: 2 } };
          else if (kind === 'token') latest = { ...session, token: 'new-token' };
          else active = false;
        }
        return response;
      });
      expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, paused: true });
      expect(stage).not.toHaveBeenCalled();
      expect(f.db.prepare('SELECT * FROM photos').all()).toHaveLength(0);
    },
  );
  it('latches an interruption even when the app returns to the foreground before download completes', async () => {
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/original')) {
        active = false;
        interrupt();
        active = true;
      }
      return response;
    });
    expect(await coordinator.run(consent)).toMatchObject({ paused: true, downloaded: 0 });
    expect(stage).not.toHaveBeenCalled();
  });
  it('removes only the newly staged file if the account changes before registration', async () => {
    const original = stage.getMockImplementation()!;
    stage.mockImplementationOnce(async (...args) => {
      const file = await original(...args);
      latest = { ...session, token: 'changed' };
      return file;
    });
    expect(await coordinator.run(consent)).toMatchObject({ paused: true, downloaded: 0 });
    expect(disposals).toHaveBeenCalledWith(false);
  });
  it('keeps a committed file when the SQL response is lost', async () => {
    const complete = f.repo.restoration.completePhoto.bind(f.repo.restoration);
    vi.spyOn(f.repo.restoration, 'completePhoto').mockImplementationOnce(async (...args) => {
      await complete(...args);
      throw Error('lost commit response');
    });
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 0 });
    expect(disposals).toHaveBeenCalledWith(true);
    expect(f.db.prepare('SELECT * FROM photos').all()).toHaveLength(1);
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 0 });
    expect(stage).toHaveBeenCalledTimes(1);
  });
  it('preserves the staged file when SQL outcome and reference lookup are both uncertain', async () => {
    vi.spyOn(f.repo.restoration, 'completePhoto').mockRejectedValueOnce(Error('uncertain commit'));
    vi.spyOn(f.repo.restoration, 'fileReferenced').mockRejectedValueOnce(
      Error('database unavailable'),
    );
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 1 });
    expect(disposals).toHaveBeenCalledWith(true);
  });
  it('reflects a later server tombstone without deleting a downloaded attachment', async () => {
    await coordinator.run(consent);
    visits[0] = { ...visits[0], revision: 2, deletedAt: epoch + 500000 };
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 0 });
    expect((await f.repo.snapshot(false)).visits).toHaveLength(0);
    expect(f.db.prepare('SELECT * FROM photos').all()).toHaveLength(1);
  });
  it('rejects stale consent and coalesces only the same current account', async () => {
    expect(await coordinator.run({ ...consent, token: 'wrong' })).toMatchObject({
      ownerId: null,
      paused: true,
    });
    expect(send).not.toHaveBeenCalled();
    const first = coordinator.run(consent),
      second = coordinator.run(consent);
    expect(second).toBe(first);
    await first;
  });
});
describe('bounded authenticated downloads', () => {
  it.each([
    { headers: { 'content-type': 'image/jpeg' }, data: bytes },
    { headers: { 'content-type': 'image/png', 'content-length': '999' }, data: bytes },
    { headers: { 'content-type': 'image/png' }, data: new Uint8Array(bytes.length + 1) },
    { headers: { 'content-type': 'image/png' }, data: bytes.slice(0, 3) },
  ])(
    'rejects incorrect MIME, declared size, stream overflow or truncation',
    async ({ headers, data }) => {
      const p = photos[0];
      const transport = vi.fn<typeof fetch>(
        async () =>
          new Response(Uint8Array.from(data), { headers: headers as Record<string, string> }),
      );
      await expect(new RestoreClient(transport).download(session, p)).rejects.toMatchObject({
        reason: 'invalid',
      });
      expect(transport.mock.calls[0][1]).toMatchObject({
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.token}` },
      });
    },
  );
  it('bounds list response bytes and hides server response bodies', async () => {
    await expect(
      new RestoreClient(async () => new Response(' '.repeat(262145))).visits(session, 0),
    ).rejects.toThrow('서버 연결');
    await expect(
      new RestoreClient(
        async () => new Response('sensitive server diagnostics', { status: 401 }),
      ).visits(session, 0),
    ).rejects.toMatchObject({ status: 401, message: expect.not.stringContaining('sensitive') });
  });
  it('never contacts a foreign/insecure origin or accepts a redirect body', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 302 }));
    await expect(
      new RestoreClient(transport).download(
        { ...session, apiUrl: 'http://outside.test' },
        photos[0],
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await expect(new RestoreClient(transport).download(session, photos[0])).rejects.toMatchObject({
      status: 302,
    });
  });
});
