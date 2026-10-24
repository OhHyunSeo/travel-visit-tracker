import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePhotoFile } from '../src/services/photoFile.native';

const mocks = vi.hoisted(() => ({
  paths: { document: 'file:///one/Documents', cache: 'file:///one/Cache' },
  files: new Map<string, Uint8Array>(),
  directories: new Set<string>(),
  sizes: new Map<string, number>(),
  copy: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  digest: vi.fn(),
  random: vi.fn(),
}));
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
    create() {
      if (this.exists) throw new Error('private existing directory');
      mocks.directories.add(this.uri);
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
  mocks.files.set(source(), Uint8Array.from(png));
  mocks.random.mockReturnValue('synthetic-attempt');
  mocks.digest.mockImplementation(
    async (_algorithm: string, bytes: Uint8Array) =>
      Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer,
  );
});

describe('photo attachment upload snapshots', () => {
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
