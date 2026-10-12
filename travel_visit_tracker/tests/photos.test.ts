import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPhoto, removePhotoFiles, resolvePhotoUri } from '../src/services/photos.native';

const mocks = vi.hoisted(() => ({
  paths: { document: 'file:///container-one/Documents' },
  pick: vi.fn(),
  add: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'photo-id' }));
vi.mock('../src/storage/database', () => ({
  getRepository: async () => ({ addPhoto: mocks.add }),
}));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    copy(target: File) {
      mocks.copy(this.uri, target.uri);
    }
    delete() {
      mocks.remove(this.uri);
    }
  }
  class Directory extends File {
    create() {}
  }
  return { File, Directory, Paths: mocks.paths };
});

beforeEach(() => {
  vi.clearAllMocks();
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
});
