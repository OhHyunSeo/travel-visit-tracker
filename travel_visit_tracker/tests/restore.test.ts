import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestoreCoordinator } from '../src/services/restore';
import { RestoreClient, RestoreFileError } from '../src/services/restoreSync';
import type {
  RemotePhoto,
  RemoteVisit,
  RestoredPhotoFile,
  RestoredFileCondition,
} from '../src/storage/restore';
import { bytes, epoch, fixture, owner, session, visit, photo } from './restoreFixture';
let f: Awaited<ReturnType<typeof fixture>>;
let latest = { ...session },
  active = true,
  interrupt: () => void;
let visits: RemoteVisit[], photos: RemotePhoto[];
let failDownload = false;
const send = vi.fn<typeof fetch>();
const disposals = vi.fn();
const files = new Map<string, Uint8Array>();
const inspect = vi.fn(async (candidate: RestoredPhotoFile): Promise<RestoredFileCondition> => {
  const b = files.get(candidate.uri);
  return !b
    ? 'missing'
    : b.length !== candidate.photo.byteLength ||
        createHash('sha256').update(b).digest('hex') !== candidate.photo.sha256
      ? 'damaged'
      : 'valid';
});
const stage = vi.fn(async (p: RemotePhoto, b: Uint8Array) => {
  if (createHash('sha256').update(b).digest('hex') !== p.sha256)
    throw new RestoreFileError('invalid');
  const uri = `visit-photos/restored-${randomUUID()}.png`;
  files.set(uri, Uint8Array.from(b));
  return {
    uri,
    dispose: async (keep: boolean) => {
      disposals(keep);
      if (!keep) files.delete(uri);
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
  files.clear();
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
    inspect,
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
  it('releases a stalled list request without advancing cursors and permits manual retry', async () => {
    vi.useFakeTimers();
    try {
      const original = send.getMockImplementation()!;
      send.mockImplementationOnce(() => new Promise(() => {}));
      const first = coordinator.run(consent);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await first).toMatchObject({
        downloaded: 0,
        message: expect.stringContaining('복원 대기'),
      });
      expect(await f.repo.restoration.state()).toMatchObject({ visitCursor: 0, photoCursor: 0 });
      expect((await f.repo.snapshot(false)).visits).toHaveLength(0);
      expect(stage).not.toHaveBeenCalled();
      send.mockImplementation(original);
      expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a stalled download queued, retries once and ignores bytes from the expired run', async () => {
    vi.useFakeTimers();
    try {
      const original = send.getMockImplementation()!;
      let finish!: (part: ReadableStreamReadResult<Uint8Array>) => void;
      const reader = {
        read: vi
          .fn<ReadableStreamDefaultReader<Uint8Array>['read']>()
          .mockResolvedValueOnce({ done: false, value: bytes.slice(0, 3) })
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          ),
        cancel: vi.fn(() => new Promise<void>(() => {})),
        releaseLock: vi.fn(),
      };
      send.mockImplementation(async (...args) =>
        String(args[0]).endsWith('/original')
          ? ({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'image/png' }),
              body: { getReader: () => reader },
            } as unknown as Response)
          : original(...args),
      );
      const first = coordinator.run(consent);
      await vi.advanceTimersByTimeAsync(30000);
      expect(await first).toMatchObject({ downloaded: 0, pending: 1 });
      expect(await f.repo.restoration.state()).toMatchObject({
        visitCursor: 1,
        photoCursor: 1,
        photoScan: 0,
      });
      expect((await f.repo.snapshot(false)).photos).toHaveLength(0);
      expect(stage).not.toHaveBeenCalled();
      send.mockImplementation(original);
      expect(await coordinator.run(consent)).toMatchObject({ downloaded: 1, pending: 0 });
      finish({ done: false, value: bytes.slice(3) });
      await vi.advanceTimersByTimeAsync(0);
      expect(stage).toHaveBeenCalledTimes(1);
      expect((await f.repo.snapshot(false)).photos).toHaveLength(1);
      expect(await f.repo.restoration.state()).toMatchObject({ pendingPhotos: 0 });
    } finally {
      vi.useRealTimers();
    }
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

describe('rechecking and repairing already restored photos', () => {
  it.each(['zero', 'same-size-corruption', 'missing'])(
    'recovers a %s file into a new verified path and preserves the old bytes/path',
    async (kind) => {
      await coordinator.run(consent);
      const original = (await f.repo.snapshot(false)).photos[0].uri;
      if (kind === 'missing') files.delete(original);
      else
        files.set(
          original,
          kind === 'zero' ? new Uint8Array() : new Uint8Array(bytes.length).fill(7),
        );
      const oldBytes = files.get(original);
      expect(await coordinator.run(consent)).toMatchObject({
        checked: 1,
        downloaded: 1,
        repaired: 1,
        pending: 0,
        paused: false,
      });
      const restored = (await f.repo.snapshot(false)).photos[0];
      expect(restored.uri).not.toBe(original);
      expect(files.get(restored.uri)).toEqual(bytes);
      expect(files.get(original)).toEqual(oldBytes);
      expect(await coordinator.run(consent)).toMatchObject({
        checked: 1,
        downloaded: 0,
        repaired: 0,
      });
    },
  );
  it('keeps the old bytes and durable repair queue when network or storage fails, then retries', async () => {
    await coordinator.run(consent);
    const original = (await f.repo.snapshot(false)).photos[0].uri;
    files.set(original, new Uint8Array());
    failDownload = true;
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 1 });
    expect(await f.repo.restoration.state()).toMatchObject({ damagedPhotos: 1 });
    stage.mockRejectedValueOnce(new RestoreFileError('storage'));
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, pending: 1 });
    expect(files.get(original)).toEqual(new Uint8Array());
    expect(await coordinator.run(consent)).toMatchObject({
      repaired: 1,
      downloaded: 1,
      pending: 0,
    });
  });
  it('does not claim a healthy file is damaged after an unreadable-file or crypto/storage error', async () => {
    await coordinator.run(consent);
    inspect.mockRejectedValueOnce(new RestoreFileError('storage'));
    expect(await coordinator.run(consent)).toMatchObject({ downloaded: 0, repaired: 0 });
    expect(await f.repo.restoration.state()).toMatchObject({ damagedPhotos: 0, pendingPhotos: 0 });
    expect(stage).toHaveBeenCalledTimes(1);
  });
  it('keeps bounded checks fair across more than 20 existing photos', async () => {
    photos = Array.from({ length: 25 }, (_, i) => photo(visits[0], { revision: i + 1 }));
    await coordinator.run(consent);
    await coordinator.run(consent);
    const target = (await f.repo.snapshot(false)).photos.find((p) => p.id === photos[24].id)!;
    files.set(target.uri, new Uint8Array());
    const result = await coordinator.run(consent);
    expect(result).toMatchObject({ checked: 20, repaired: 1, pending: 0 });
    expect(inspect.mock.calls.length).toBe(40);
  });
  it('never relinks a repair if the token changes after staging, and a new explicit run resumes', async () => {
    await coordinator.run(consent);
    const original = (await f.repo.snapshot(false)).photos[0].uri;
    files.set(original, new Uint8Array());
    const prepare = stage.getMockImplementation()!;
    stage.mockImplementationOnce(async (...args) => {
      const file = await prepare(...args);
      latest = { ...session, token: 'different' };
      return file;
    });
    expect(await coordinator.run(consent)).toMatchObject({ paused: true, repaired: 0 });
    expect((await f.repo.snapshot(false)).photos[0].uri).toBe(original);
    latest = { ...session };
    expect(await coordinator.run(consent)).toMatchObject({ repaired: 1, pending: 0 });
  });
});

it('persists a bounded integrity scan and reports unchecked migrated files instead of full completion', async () => {
  photos = Array.from({ length: 40 }, (_, i) => photo(visits[0], { revision: i + 1 }));
  await coordinator.run(consent);
  await coordinator.run(consent);
  f.db.exec("UPDATE restore_files SET state='unchecked';UPDATE restore_state SET verify_scan=0");
  const first = await coordinator.run(consent);
  expect(first).toMatchObject({ checked: 20, downloaded: 0 });
  expect(first.message).toContain('20개는 다음 실행');
  expect(await f.repo.restoration.state()).toMatchObject({ uncheckedPhotos: 20, verifyScan: 20 });
  expect(await coordinator.run(consent)).toMatchObject({ checked: 20, downloaded: 0 });
  expect(await f.repo.restoration.state()).toMatchObject({ uncheckedPhotos: 0 });
});
