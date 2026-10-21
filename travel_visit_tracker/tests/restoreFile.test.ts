import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  copyFileSync,
  unlinkSync,
  constants,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytes, photo, visit } from './restoreFixture';
import { stageRestoredFile } from '../src/services/restoreFile.native';
const mock = vi.hoisted(() => ({
  paths: { document: '', cache: '' },
  random: vi.fn(),
  copy: vi.fn(),
  digest: vi.fn(),
}));
vi.mock('expo-crypto', () => ({
  randomUUID: mock.random,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: mock.digest,
}));
vi.mock('expo-file-system', () => {
  const path = (parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts);
    }
    get exists() {
      return existsSync(this.uri);
    }
    get size() {
      return statSync(this.uri).size;
    }
    create() {
      writeFileSync(this.uri, new Uint8Array(), { flag: 'wx' });
    }
    write(b: Uint8Array) {
      writeFileSync(this.uri, b);
    }
    async bytes() {
      return readFileSync(this.uri);
    }
    async copy(target: File, options: { overwrite?: boolean } = {}) {
      await mock.copy(this.uri, target.uri);
      copyFileSync(this.uri, target.uri, options.overwrite ? 0 : constants.COPYFILE_EXCL);
    }
    delete() {
      unlinkSync(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(parts);
    }
    get exists() {
      return existsSync(this.uri);
    }
    create(options: { idempotent?: boolean } = {}) {
      if (!options.idempotent && this.exists) throw Error('exists');
      mkdirSync(this.uri, { recursive: !!options.idempotent });
    }
    delete() {
      rmSync(this.uri, { recursive: true });
    }
  }
  return { File, Directory, Paths: mock.paths };
});
let root: string, cacheId: string, fileId: string;
const durable = () => join(mock.paths.document, 'visit-photos', `restored-${fileId}.png`);
const temporary = () => join(mock.paths.cache, `photo-restore-${cacheId}`);
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), 'trip-restore-file-'));
  mock.paths.document = join(root, 'Documents');
  mock.paths.cache = join(root, 'Cache');
  mkdirSync(mock.paths.document);
  mkdirSync(mock.paths.cache);
  cacheId = randomUUID();
  fileId = randomUUID();
  mock.random.mockReturnValueOnce(cacheId).mockReturnValueOnce(fileId);
  mock.digest.mockImplementation(
    async (_algorithm: string, b: Uint8Array) =>
      Uint8Array.from(createHash('sha256').update(b).digest()).buffer,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe('exclusive verified restore files', () => {
  it('writes and verifies a durable relative path and removes only the cache after commit', async () => {
    const staged = await stageRestoredFile(photo(visit()), bytes);
    expect(staged.uri).toBe(`visit-photos/restored-${fileId}.png`);
    expect(readFileSync(durable())).toEqual(Buffer.from(bytes));
    await staged.dispose(true);
    expect(existsSync(temporary())).toBe(false);
    expect(readFileSync(durable())).toEqual(Buffer.from(bytes));
  });
  it('removes its new durable file after an uncommitted registration', async () => {
    const staged = await stageRestoredFile(photo(visit()), bytes);
    await staged.dispose(false);
    await staged.dispose(false);
    expect(existsSync(durable())).toBe(false);
    expect(existsSync(temporary())).toBe(false);
  });
  it('keeps a preexisting durable file on a collision', async () => {
    mkdirSync(join(mock.paths.document, 'visit-photos'));
    writeFileSync(durable(), 'keep original');
    await expect(stageRestoredFile(photo(visit()), bytes)).rejects.toMatchObject({
      reason: 'storage',
    });
    expect(readFileSync(durable(), 'utf8')).toBe('keep original');
    expect(existsSync(temporary())).toBe(false);
  });
  it('keeps a preexisting cache directory on a collision', async () => {
    mkdirSync(temporary());
    writeFileSync(join(temporary(), 'keep'), 'keep original');
    await expect(stageRestoredFile(photo(visit()), bytes)).rejects.toMatchObject({
      reason: 'storage',
    });
    expect(readFileSync(join(temporary(), 'keep'), 'utf8')).toBe('keep original');
  });
  it('rejects correct-sized bytes with a bad hash and removes only its own staging files', async () => {
    await expect(
      stageRestoredFile(photo(visit(), { sha256: 'f'.repeat(64) }), bytes),
    ).rejects.toMatchObject({ reason: 'invalid' });
    expect(existsSync(temporary())).toBe(false);
    expect(existsSync(durable())).toBe(false);
  });
  it('rejects a mismatched signature even if its hash and size agree', async () => {
    const p = photo(visit(), { mimeType: 'image/jpeg' });
    await expect(stageRestoredFile(p, bytes)).rejects.toMatchObject({ reason: 'invalid' });
    expect(existsSync(temporary())).toBe(false);
  });
  it('awaits a native asynchronous copy before verifying and returning', async () => {
    let finish!: () => void;
    mock.copy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let done = false;
    const pending = stageRestoredFile(photo(visit()), bytes).then((f) => {
      done = true;
      return f;
    });
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    expect(done).toBe(false);
    finish();
    const staged = await pending;
    expect(readFileSync(durable())).toEqual(Buffer.from(bytes));
    await staged.dispose(false);
  });
  it('removes a partial destination after a native copy error', async () => {
    mock.copy.mockImplementation((_from: string, to: string) => {
      writeFileSync(to, 'partial');
      throw Error('private path');
    });
    await expect(stageRestoredFile(photo(visit()), bytes)).rejects.toMatchObject({
      reason: 'storage',
      message: expect.not.stringContaining('private'),
    });
    expect(existsSync(temporary())).toBe(false);
    expect(existsSync(durable())).toBe(false);
  });
});
