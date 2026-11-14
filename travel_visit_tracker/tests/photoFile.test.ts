import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePhotoFile, cleanupPreparedPhotoFiles } from '../src/services/photoFile.native';
import {
  snapshotMarker,
  snapshotRoot,
  type PhotoSnapshotManifest,
} from '../src/services/photoSnapshot';

const mocks = vi.hoisted(() => ({
  paths: { document: 'file:///one/Documents', cache: 'file:///one/Cache' },
  files: new Map<string, Uint8Array>(),
  directories: new Set<string>(),
  sizes: new Map<string, number>(),
  copy: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  digest: vi.fn(),
  random: vi.fn(),
  constants: { sessionId: '00000000-0000-4000-8000-000000000001' },
}));
vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: mocks.digest,
  randomUUID: mocks.random,
}));
vi.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    get name() {
      return this.uri.split('/').at(-1)!;
    }
    create() {
      if (this.exists) throw Error('existing file');
      mocks.files.set(this.uri, new Uint8Array());
    }
    write(value: string | Uint8Array) {
      mocks.write(this.uri);
      mocks.files.set(
        this.uri,
        typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value),
      );
    }
    delete() {
      mocks.remove(this.uri);
      mocks.files.delete(this.uri);
    }
    textSync() {
      return new TextDecoder().decode(this.bytesSync());
    }
    async text() {
      return this.textSync();
    }
    bytesSync() {
      mocks.read(this.uri);
      const bytes = mocks.files.get(this.uri);
      if (!bytes) throw Error('missing file');
      return Uint8Array.from(bytes);
    }
    get size() {
      return mocks.sizes.get(this.uri) ?? mocks.files.get(this.uri)?.length ?? 0;
    }
    get type() {
      return this.uri.endsWith('.png')
        ? 'image/png'
        : this.uri.endsWith('.jpg')
          ? 'image/jpeg'
          : '';
    }
    rename(name: string) {
      const next = `${this.uri.slice(0, this.uri.lastIndexOf('/'))}/${name}`;
      const bytes = mocks.files.get(this.uri)!;
      mocks.files.delete(this.uri);
      mocks.files.set(next, bytes);
      this.uri = next;
    }
    async arrayBuffer() {
      return Uint8Array.from(mocks.files.get(this.uri)!).buffer;
    }
    async copy(target: File) {
      const source = mocks.files.get(this.uri);
      if (!source) throw new Error('private missing path');
      await mocks.copy(this.uri, target.uri);
      if (!mocks.files.has(target.uri)) mocks.files.set(target.uri, Uint8Array.from(source));
    }
    async bytes() {
      mocks.read(this.uri);
      const value = mocks.files.get(this.uri);
      if (!value) throw new Error('private unreadable path');
      return value;
    }
    slice(start: number, end: number, type: string) {
      return new Blob([Uint8Array.from(mocks.files.get(this.uri)!).slice(start, end)], { type });
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return mocks.directories.has(this.uri);
    }
    get name() {
      return this.uri.split('/').at(-1)!;
    }
    create(options?: { idempotent?: boolean }) {
      mocks.create(this.uri);
      if (this.exists && !options?.idempotent) throw new Error('private existing directory');
      mocks.directories.add(this.uri);
    }
    list() {
      mocks.list(this.uri);
      const prefix = this.uri + '/';
      return [...new Set([...mocks.directories, ...mocks.files.keys()])]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => (mocks.directories.has(p) ? new Directory(p) : new File(p)));
    }
    delete() {
      mocks.remove(this.uri);
      for (const path of mocks.files.keys())
        if (path.startsWith(`${this.uri}/`)) mocks.files.delete(path);
      mocks.directories.delete(this.uri);
    }
  }
  return { File, Directory, Paths: mocks.paths };
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const relative = 'visit-photos/photo-one.png';
const source = () => `${mocks.paths.document}/${relative}`;
const snapshot = () => `${mocks.paths.cache}/photo-backup-synthetic-attempt/attachment`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.files.clear();
  mocks.directories.clear();
  mocks.sizes.clear();
  mocks.paths.document = 'file:///one/Documents';
  mocks.paths.cache = 'file:///one/Cache';
  mocks.constants.sessionId = '00000000-0000-4000-8000-000000000001';
  const runtime = (
    globalThis as typeof globalThis & {
      __tripPaintingPhotoSnapshotsV1: { active: Set<string>; cleaning: boolean; after: string };
    }
  ).__tripPaintingPhotoSnapshotsV1;
  runtime.active.clear();
  runtime.cleaning = false;
  runtime.after = '';
  mocks.files.set(source(), Uint8Array.from(png));
  mocks.random.mockReturnValue('synthetic-attempt');
  mocks.digest.mockImplementation(
    async (_algorithm: string, bytes: Uint8Array) =>
      Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer,
  );
});

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const context = {
  ownerId: 'account:https://synthetic.example.test:1',
  operationId: uuid(10),
  photoId: uuid(11),
};
function seedSnapshot(n = 100, content = png) {
  const attemptId = uuid(n),
    root = `${mocks.paths.cache}/${snapshotRoot}`,
    directory = `${root}/${attemptId}`;
  mocks.directories.add(root);
  mocks.directories.add(directory);
  const manifest: PhotoSnapshotManifest = {
    ...context,
    format: 'trip-painting-upload-snapshot-v1',
    attemptId,
    nativeSessionId: uuid(2),
    sourceUri: relative,
    fileName: 'attachment.png',
    sha256: hash(content),
    byteLength: content.length,
    mimeType: 'image/png',
  };
  const marker = `${directory}/${snapshotMarker}`,
    copy = `${directory}/attachment.png`;
  mocks.files.set(source(), Uint8Array.from(content));
  mocks.files.set(copy, Uint8Array.from(content));
  const save = () => mocks.files.set(marker, new TextEncoder().encode(JSON.stringify(manifest)));
  save();
  return { directory, copy, marker, manifest, save };
}
const maintenance = (guard = () => true) => ({
  ownerId: context.ownerId,
  isCurrent: guard,
  removeAcknowledged: vi.fn(async (_manifest: PhotoSnapshotManifest, remove: () => boolean) =>
    remove(),
  ),
});

describe('acknowledged previous-session upload cache cleanup', () => {
  it('records new relative uploads with ownership while retaining their active copy', async () => {
    mocks.random.mockReturnValue(uuid(50));
    const prepared = await preparePhotoFile(relative, context);
    const marker = `${mocks.paths.cache}/${snapshotRoot}/${uuid(50)}/${snapshotMarker}`;
    const m = JSON.parse(new TextDecoder().decode(mocks.files.get(marker)));
    expect(m).toMatchObject({
      ...context,
      nativeSessionId: uuid(1),
      sha256: hash(png),
      sourceUri: relative,
    });
    mocks.constants.sessionId = uuid(3);
    const options = maintenance();
    expect(await cleanupPreparedPhotoFiles(options)).toMatchObject({ removed: 0 });
    expect(options.removeAcknowledged).not.toHaveBeenCalled();
    await prepared.dispose();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('does not enroll legacy absolute paths into automatic deletion', async () => {
    const prepared = await preparePhotoFile(source(), context);
    expect([...mocks.files.keys()].some((p) => p.endsWith(snapshotMarker))).toBe(false);
    await prepared.dispose();
  });
  it('removes only a proven duplicate and keeps source bytes and unrelated caches', async () => {
    const owned = seedSnapshot();
    const legacy = `${mocks.paths.cache}/photo-backup-${uuid(77)}/attachment.png`;
    mocks.files.set(legacy, Uint8Array.from(png));
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({
      removed: 1,
      bytesRemoved: png.length,
    });
    expect(mocks.files.has(owned.copy)).toBe(false);
    expect(mocks.files.has(owned.marker)).toBe(false);
    expect(mocks.files.get(source())).toEqual(png);
    expect(mocks.files.get(legacy)).toEqual(png);
  });
  it.each([
    'current-session',
    'foreign-owner',
    'no-marker',
    'extra-file',
    'bad-marker',
    'missing-source',
    'changed-source',
    'changed-copy',
  ])('preserves an unproven snapshot: %s', async (reason) => {
    const item = seedSnapshot();
    if (reason === 'current-session') {
      item.manifest.nativeSessionId = uuid(1);
      item.save();
    }
    if (reason === 'foreign-owner') {
      item.manifest.ownerId += 'other';
      item.save();
    }
    if (reason === 'no-marker') mocks.files.delete(item.marker);
    if (reason === 'extra-file') mocks.files.set(item.directory + '/keep.txt', new Uint8Array([1]));
    if (reason === 'bad-marker') mocks.files.set(item.marker, new TextEncoder().encode('{broken'));
    if (reason === 'missing-source') mocks.files.delete(source());
    if (reason === 'changed-source') mocks.files.set(source(), new Uint8Array(png.length).fill(9));
    if (reason === 'changed-copy') mocks.files.set(item.copy, new Uint8Array(png.length).fill(9));
    const before = new Map(mocks.files);
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({ removed: 0 });
    expect(mocks.files).toEqual(before);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('keeps an unacknowledged operation even when the file is a valid duplicate', async () => {
    const item = seedSnapshot(),
      options = maintenance();
    options.removeAcknowledged.mockResolvedValue(false);
    expect(await cleanupPreparedPhotoFiles(options)).toMatchObject({ removed: 0 });
    expect(mocks.files.has(item.copy)).toBe(true);
  });
  it.each(['logout', 'source-change', 'extra-file'])(
    'rechecks before removal after asynchronous hashing: %s',
    async (reason) => {
      const item = seedSnapshot();
      let active = true;
      const options = maintenance(() => active);
      options.removeAcknowledged.mockImplementation(async (_m, remove) => {
        if (reason === 'logout') active = false;
        if (reason === 'source-change')
          mocks.files.set(source(), new Uint8Array(png.length).fill(7));
        if (reason === 'extra-file')
          mocks.files.set(item.directory + '/keep.txt', new Uint8Array([8]));
        return remove();
      });
      expect(await cleanupPreparedPhotoFiles(options)).toMatchObject({ removed: 0 });
      expect(mocks.files.get(item.copy)).toEqual(png);
    },
  );
  it('bounds inspections to twenty entries and rotates past retained entries', async () => {
    for (let i = 100; i < 125; i++) seedSnapshot(i);
    const first = await cleanupPreparedPhotoFiles(maintenance());
    expect(first).toMatchObject({ examined: 20, removed: 20 });
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({ removed: 5 });
  });
  it('bounds snapshot and original byte reads to 64MiB per pass', async () => {
    const large = new Uint8Array(10 * 1024 * 1024);
    large.set(png);
    for (let i = 100; i < 105; i++) seedSnapshot(i, large);
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({
      removed: 2,
      bytesRemoved: large.length * 2,
    });
    expect(hash(mocks.files.get(source())!)).toBe(hash(large));
  });
  it.each(['root-list', 'copy-read', 'source-read', 'copy-delete'])(
    'preserves a duplicate through a %s storage error and resumes cleanup after recovery',
    async (failure) => {
      const item = seedSnapshot();
      const before = new Map(mocks.files);
      const fail = (path: string) => {
        const blocked = {
          'root-list': `${mocks.paths.cache}/${snapshotRoot}`,
          'copy-read': item.copy,
          'source-read': source(),
          'copy-delete': item.copy,
        }[failure]!;
        if (path === blocked) throw Error('synthetic EACCES, private path');
      };
      if (failure === 'root-list') mocks.list.mockImplementation(fail);
      else if (failure === 'copy-delete') mocks.remove.mockImplementation(fail);
      else mocks.read.mockImplementation(fail);
      await expect(cleanupPreparedPhotoFiles(maintenance())).resolves.toMatchObject({
        removed: 0,
        bytesRemoved: 0,
      });
      expect(mocks.files).toEqual(before);
      mocks.list.mockReset();
      mocks.remove.mockReset();
      mocks.read.mockReset();
      expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({
        examined: 1,
        removed: 1,
      });
      expect(mocks.files.get(source())).toEqual(png);
      expect(mocks.files.has(item.copy)).toBe(false);
    },
  );
  it('continues past one unreadable duplicate and retries it on a later pass', async () => {
    const blocked = seedSnapshot(100),
      healthy = seedSnapshot(101);
    mocks.read.mockImplementation((path: string) => {
      if (path === blocked.copy) throw Error('synthetic EIO');
    });
    const options = maintenance();
    expect(await cleanupPreparedPhotoFiles(options)).toMatchObject({ examined: 2, removed: 1 });
    expect(options.removeAcknowledged).toHaveBeenCalledTimes(1);
    expect(mocks.files.get(blocked.copy)).toEqual(png);
    expect(mocks.files.has(healthy.copy)).toBe(false);
    mocks.read.mockReset();
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({ removed: 1 });
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('retains tiny metadata when its deletion fails without undoing a proven body removal', async () => {
    const item = seedSnapshot();
    const marker = Uint8Array.from(mocks.files.get(item.marker)!);
    mocks.remove.mockImplementation((path: string) => {
      if (path === item.marker) throw Error('synthetic EACCES');
    });
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({
      removed: 1,
      bytesRemoved: png.length,
    });
    expect(mocks.files.has(item.copy)).toBe(false);
    expect(mocks.files.get(item.marker)).toEqual(marker);
    mocks.remove.mockReset();
    const options = maintenance();
    expect(await cleanupPreparedPhotoFiles(options)).toMatchObject({ removed: 0 });
    expect(options.removeAcknowledged).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('makes bounded progress through repeated additions while preserving a mixed retained backlog', async () => {
    const retained = new Set<string>();
    for (let n = 100; n < 165; n++) {
      const item = seedSnapshot(n);
      if (n % 3 === 0) mocks.files.delete(item.marker);
      else if (n % 3 === 1) {
        item.manifest.ownerId += ':other';
        item.save();
      } else {
        item.manifest.operationId = uuid(5000 + n);
        retained.add(item.manifest.operationId);
        item.save();
      }
    }
    const preserved = new Map(mocks.files);
    const options = maintenance();
    options.removeAcknowledged.mockImplementation(async (manifest, remove) =>
      retained.has(manifest.operationId) ? false : remove(),
    );
    let removed = 0;
    for (let cycle = 0; cycle < 10; cycle++) {
      const items = Array.from({ length: 12 }, (_, n) => seedSnapshot(1000 + cycle * 12 + n));
      for (let pass = 0; pass < 8 && items.some((item) => mocks.files.has(item.copy)); pass++) {
        const result = await cleanupPreparedPhotoFiles(options);
        expect(result.examined).toBeLessThanOrEqual(20);
        removed += result.removed;
      }
      expect(items.every((item) => !mocks.files.has(item.copy))).toBe(true);
      expect(mocks.files).toEqual(preserved);
    }
    expect(removed).toBe(120);
    expect(mocks.files.get(source())).toEqual(png);
  });
});

describe('photo attachment upload snapshots', () => {
  it.each(['directory-create', 'marker-write'])(
    'preserves the attachment and supports a fresh retry after %s runs out of space',
    async (failure) => {
      mocks.random.mockReturnValueOnce(uuid(50)).mockReturnValueOnce(uuid(51));
      const unavailable = () => {
        throw Error('synthetic ENOSPC, private path');
      };
      if (failure === 'directory-create') mocks.create.mockImplementationOnce(unavailable);
      else mocks.write.mockImplementationOnce(unavailable);
      await expect(preparePhotoFile(relative, context)).rejects.toMatchObject({
        reason: 'invalid',
      });
      expect(mocks.files).toEqual(new Map([[source(), png]]));
      const next = await preparePhotoFile(relative, context);
      expect(next.fingerprint.sha256).toBe(hash(png));
      await next.dispose();
      expect(mocks.files).toEqual(new Map([[source(), png]]));
    },
  );
  it('preserves an unmarked partial copy if both writing and disposing fail, without blocking a fresh attempt', async () => {
    mocks.random.mockReturnValueOnce(uuid(50)).mockReturnValueOnce(uuid(51));
    const directory = `${mocks.paths.cache}/${snapshotRoot}/${uuid(50)}`;
    const partial = `${directory}/attachment`;
    mocks.copy.mockImplementationOnce((_source, target) => {
      mocks.files.set(target, new Uint8Array([7]));
      throw Error('synthetic ENOSPC');
    });
    mocks.remove.mockImplementationOnce(() => {
      throw Error('synthetic EACCES');
    });
    await expect(preparePhotoFile(relative, context)).rejects.toMatchObject({ reason: 'invalid' });
    const preserved = new Map(mocks.files);
    expect(mocks.files.get(partial)).toEqual(new Uint8Array([7]));
    const next = await preparePhotoFile(relative, context);
    await next.dispose();
    expect(await cleanupPreparedPhotoFiles(maintenance())).toMatchObject({ removed: 0 });
    expect(mocks.files).toEqual(preserved);
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('hashes and uploads the snapshot while keeping a concurrently changed original', async () => {
    mocks.copy.mockImplementation(() => mocks.files.set(source(), new Uint8Array([9, 9, 9])));
    const prepared = await preparePhotoFile(relative);
    expect(prepared.fingerprint).toEqual({
      sha256: hash(png),
      byteLength: png.length,
      mimeType: 'image/png',
    });
    expect(new Uint8Array(await prepared.body.arrayBuffer())).toEqual(png);
    await prepared.dispose();
    await prepared.dispose();
    expect(mocks.files.has(snapshot())).toBe(false);
    expect(mocks.files.get(source())).toEqual(new Uint8Array([9, 9, 9]));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
      `${mocks.paths.cache}/photo-backup-synthetic-attempt`,
    );
  });
  it('resolves relative paths after the app container moves', async () => {
    mocks.paths.document = 'file:///two/Documents';
    mocks.files.set(source(), Uint8Array.from(png));
    const prepared = await preparePhotoFile(relative);
    expect(mocks.copy.mock.calls[0][0]).toBe(source());
    await prepared.dispose();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('accepts only a direct attachment file in the current absolute document path', async () => {
    const prepared = await preparePhotoFile(source());
    await prepared.dispose();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it.each([
    'file:///private/auth.json',
    'file:///old/Documents/visit-photos/photo-one.png',
    'https://example.test/photo.png',
    'visit-photos/../auth.png',
    'visit-photos/%2e%2e%2fauth.png',
    'visit-photos/nested/photo.png',
  ])('does not read or remove an untrusted URI: %s', async (uri) => {
    await expect(preparePhotoFile(uri)).rejects.toMatchObject({ reason: 'invalid' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(['heic', 'webp'])(
    'keeps unsupported %s files without reading or converting them',
    async (extension) => {
      await expect(preparePhotoFile(`visit-photos/photo.${extension}`)).rejects.toMatchObject({
        reason: 'unsupported',
      });
      expect(mocks.copy).not.toHaveBeenCalled();
      expect(mocks.digest).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
  it('keeps missing attachments pending without a cache copy', async () => {
    mocks.files.delete(source());
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'missing' });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects oversized files before copying or hashing', async () => {
    mocks.sizes.set(source(), 10 * 1024 * 1024 + 1);
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'tooLarge' });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('accepts the inclusive size limit and disposes only its own copy', async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024);
    bytes.set(png);
    mocks.files.set(source(), bytes);
    const prepared = await preparePhotoFile(relative);
    expect(prepared.fingerprint.byteLength).toBe(bytes.length);
    await prepared.dispose();
    expect(mocks.files.get(source())).toBe(bytes);
  });
  it('checks copied bytes again if the file grew during copying', async () => {
    mocks.copy.mockImplementation(() =>
      mocks.files.set(snapshot(), new Uint8Array(10 * 1024 * 1024 + 1)),
    );
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'tooLarge' });
    expect(mocks.files.has(snapshot())).toBe(false);
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('uses actual JPEG/PNG bytes for MIME even when the extension differs', async () => {
    mocks.files.set(source(), new Uint8Array([255, 216, 255, 1]));
    const prepared = await preparePhotoFile(relative);
    expect(prepared.body.type).toBe('image/jpeg');
    expect(prepared.fingerprint.mimeType).toBe('image/jpeg');
    await prepared.dispose();
  });
  it('rejects unrecognizable bytes and preserves the durable file', async () => {
    mocks.files.set(source(), new Uint8Array([1, 2, 3]));
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'invalid' });
    expect(mocks.files.get(source())).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.files.has(snapshot())).toBe(false);
  });
  it('removes only an owned partial copy after a copy error', async () => {
    mocks.copy.mockImplementation(() => {
      mocks.files.set(snapshot(), new Uint8Array([7]));
      throw new Error('private path and copy error');
    });
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'invalid' });
    expect(mocks.files.has(snapshot())).toBe(false);
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('waits for native async copying before reading or disposing its destination', async () => {
    let finish!: () => void;
    mocks.copy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loading = preparePhotoFile(relative);
    await Promise.resolve();
    expect(mocks.files.has(snapshot())).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    finish();
    const prepared = await loading;
    expect(prepared.fingerprint.sha256).toBe(hash(png));
    await prepared.dispose();
    expect(mocks.files.get(source())).toEqual(png);
  });
  it('does not delete a preexisting cache directory on a name collision', async () => {
    const dir = `${mocks.paths.cache}/photo-backup-synthetic-attempt`;
    mocks.directories.add(dir);
    mocks.files.set(`${dir}/keep`, new Uint8Array([7]));
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({ reason: 'invalid' });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.files.get(`${dir}/keep`)).toEqual(new Uint8Array([7]));
  });
  it('normalizes hashing failures and keeps the original bytes', async () => {
    mocks.digest.mockRejectedValue(new Error('file:///private/sensitive-error'));
    await expect(preparePhotoFile(relative)).rejects.toMatchObject({
      reason: 'invalid',
      message: '사진 파일을 확인하지 못했습니다. 원본과 전송 대기는 유지합니다.',
    });
    expect(mocks.files.get(source())).toEqual(png);
    expect(mocks.files.has(snapshot())).toBe(false);
  });
});
