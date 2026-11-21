import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPhoto, removePhotoFiles, resolvePhotoUri } from '../src/services/photos.native';

const mocks = vi.hoisted(() => ({
  paths: { document: 'file:///container-one/Documents' },
  pick: vi.fn(),
  add: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  existing: new Set<string>(),
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'photo-id' }));
vi.mock('../src/storage/database', () => ({
  getRepository: async () => ({ addPhoto: mocks.add }),
}));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    get exists() {
      return mocks.existing.has(this.uri);
    }
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {
      if (this.exists) throw new Error('file already exists');
      mocks.existing.add(this.uri);
    }
    async copy(target: File) {
      await mocks.copy(this.uri, target.uri);
    }
    delete() {
      mocks.remove(this.uri);
      mocks.existing.delete(this.uri);
    }
  }
  class Directory extends File {
    create() {}
  }
  return { File, Directory, Paths: mocks.paths };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing.clear();
  mocks.copy.mockReset();
  mocks.paths.document = 'file:///container-one/Documents';
  mocks.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///picker/tmp.jpg', fileName: 'photo.jpg' }],
  });
  mocks.add.mockResolvedValue(undefined);
});
describe('durable photo paths', () => {
  it('resolves a saved photo using the current iOS container after relocation', async () => {
    await attachPhoto('visit');
    const saved = mocks.add.mock.calls[0][0];
    expect(saved.uri).toBe('visit-photos/photo-id.jpg');
    mocks.paths.document = 'file:///container-two/Documents';
    mocks.existing.delete('file:///container-one/Documents/visit-photos/photo-id.jpg');
    mocks.existing.add('file:///container-two/Documents/visit-photos/photo-id.jpg');
    expect(resolvePhotoUri(saved.uri)).toBe(
      'file:///container-two/Documents/visit-photos/photo-id.jpg',
    );
    await removePhotoFiles([saved.uri]);
    expect(mocks.remove).toHaveBeenCalledWith(
      'file:///container-two/Documents/visit-photos/photo-id.jpg',
    );
  });
  it('does not create a record when the picker is canceled', async () => {
    mocks.pick.mockResolvedValue({ canceled: true, assets: null });
    expect(await attachPhoto('visit')).toBe(false);
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('removes the copied file when database linking fails', async () => {
    mocks.add.mockRejectedValue(new Error('database unavailable'));
    await expect(attachPhoto('visit')).rejects.toThrow('database unavailable');
    expect(mocks.remove).toHaveBeenCalledWith(
      'file:///container-one/Documents/visit-photos/photo-id.jpg',
    );
  });
  it('waits for native copy completion before adding the photo record', async () => {
    let finish!: () => void;
    mocks.copy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const attaching = attachPhoto('visit');
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    finish();
    expect(await attaching).toBe(true);
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
  it('cleans only its newly created file if async copying rejects', async () => {
    mocks.copy.mockRejectedValue(new Error('copy failed'));
    await expect(attachPhoto('visit')).rejects.toThrow('copy failed');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
      'file:///container-one/Documents/visit-photos/photo-id.jpg',
    );
  });
  it('preserves an existing attachment on a generated name collision', async () => {
    mocks.existing.add('file:///container-one/Documents/visit-photos/photo-id.jpg');
    await expect(attachPhoto('visit')).rejects.toThrow('file already exists');
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.existing.has('file:///container-one/Documents/visit-photos/photo-id.jpg')).toBe(
      true,
    );
  });
});
