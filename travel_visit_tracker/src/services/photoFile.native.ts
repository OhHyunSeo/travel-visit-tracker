import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { PhotoFileError, type PreparedPhotoFile } from './photoSync';

const maxBytes = 10 * 1024 * 1024;

// Only app attachments can be sent; a malformed queue must not read other local files.
function attachment(uri: string): File {
  const base = new Directory(Paths.document, 'visit-photos').uri.replace(/\/$/, '');
  const name = uri.startsWith('visit-photos/')
    ? uri.slice('visit-photos/'.length)
    : uri.startsWith(`${base}/`)
      ? uri.slice(base.length + 1)
      : '';
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|heic|webp)$/i.test(name))
    throw new PhotoFileError('invalid');
  if (/\.(heic|webp)$/i.test(name)) throw new PhotoFileError('unsupported');
  return new File(Paths.document, 'visit-photos', name);
}

export async function preparePhotoFile(uri: string): Promise<PreparedPhotoFile> {
  const source = attachment(uri);
  let owned: Directory | null = null;
  const dispose = async () => {
    if (owned?.exists) owned.delete();
    owned = null;
  };
  try {
    if (!source.exists) throw new PhotoFileError('missing');
    if (source.size > maxBytes) throw new PhotoFileError('tooLarge');
    // An exclusive per-attempt copy binds the hash and multipart body to the same bytes.
    const directory = new Directory(Paths.cache, `photo-backup-${Crypto.randomUUID()}`);
    directory.create();
    owned = directory;
    const frozen = new File(directory, 'attachment');
    await source.copy(frozen);
    if (!frozen.exists) throw new PhotoFileError('missing');
    if (frozen.size > maxBytes) throw new PhotoFileError('tooLarge');
    const bytes = Uint8Array.from(await frozen.bytes());
    if (bytes.byteLength > maxBytes) throw new PhotoFileError('tooLarge');
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg) throw new PhotoFileError('invalid');
    const mimeType = png ? 'image/png' : 'image/jpeg';
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    frozen.rename(mimeType === 'image/png' ? 'attachment.png' : 'attachment.jpg');
    return {
      fingerprint: { sha256, byteLength: bytes.byteLength, mimeType },
      body: frozen,
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Only this attempt's cache may remain. The durable attachment is never removed.
    }
    if (error instanceof PhotoFileError) throw error;
    throw new PhotoFileError('invalid');
  }
}
