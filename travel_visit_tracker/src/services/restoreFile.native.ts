import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { RemotePhoto, RestoredPhotoFile, RestoredFileCondition } from '../storage/restore';
import { remotePhoto, restoredPhotoUri } from '../storage/restore';
import { RestoreFileError } from './restoreSync';
export type RestoredFile = { uri: string; dispose(keep: boolean): Promise<void> };

async function verify(file: File, photo: RemotePhoto) {
  if (!file.exists || file.size !== photo.byteLength) throw new RestoreFileError('invalid');
  const bytes = Uint8Array.from(await file.bytes());
  if (bytes.byteLength !== photo.byteLength) throw new RestoreFileError('invalid');
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (photo.mimeType === 'image/png' ? !png : !jpeg) throw new RestoreFileError('invalid');
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== photo.sha256) throw new RestoreFileError('invalid');
}
export async function inspectRestoredFile(
  candidate: RestoredPhotoFile,
): Promise<RestoredFileCondition> {
  const photo = remotePhoto(candidate.photo);
  // No absolute paths, external URIs, user attachments or arbitrary server filenames.
  if (!restoredPhotoUri(candidate.uri)) throw new RestoreFileError('storage');
  const file = new File(Paths.document, candidate.uri);
  try {
    if (!file.exists) return 'missing';
    await verify(file, photo);
    return 'valid';
  } catch (error) {
    if (error instanceof RestoreFileError && error.reason === 'invalid') return 'damaged';
    throw new RestoreFileError('storage');
  }
}
export async function stageRestoredFile(
  metadata: RemotePhoto,
  bytes: Uint8Array,
): Promise<RestoredFile> {
  const photo = remotePhoto(metadata);
  if (bytes.byteLength !== photo.byteLength) throw new RestoreFileError('invalid');
  let cache: Directory | null = null,
    durable: File | null = null;
  const dispose = async (keep: boolean) => {
    // Neither location is shared with another attempt or an existing attachment.
    try {
      if (cache?.exists) cache.delete();
    } finally {
      if (!keep && durable?.exists) durable.delete();
    }
  };
  try {
    const owned = new Directory(Paths.cache, `photo-restore-${Crypto.randomUUID()}`);
    owned.create();
    cache = owned;
    const temporary = new File(owned, 'download');
    temporary.create();
    temporary.write(bytes);
    await verify(temporary, photo);
    new Directory(Paths.document, 'visit-photos').create({ intermediates: true, idempotent: true });
    const name = `restored-${Crypto.randomUUID()}.${photo.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const destination = new File(Paths.document, 'visit-photos', name);
    destination.create();
    durable = destination; // Exclusive creation: a collision never becomes owned.
    await temporary.copy(destination, { overwrite: true });
    await verify(destination, photo);
    return { uri: `visit-photos/${name}`, dispose };
  } catch (error) {
    try {
      await dispose(false);
    } catch {
      /* Only this attempt's generated files can remain. */
    }
    if (error instanceof RestoreFileError) throw error;
    throw new RestoreFileError('storage');
  }
}
