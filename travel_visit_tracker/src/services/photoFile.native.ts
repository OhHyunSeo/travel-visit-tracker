import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { PhotoFileError, type PreparedPhotoFile } from './photoSync';
import {
  snapshotRoot,
  snapshotMarker,
  snapshotUuid,
  validSnapshotContext,
  readSnapshotManifest,
  type PhotoSnapshotContext,
  type PhotoSnapshotManifest,
  type PhotoSnapshotCleanup,
  type PhotoSnapshotCleanupOptions,
} from './photoSnapshot';

const maxBytes = 10 * 1024 * 1024;
type Runtime = { active: Set<string>; cleaning: boolean; after: string };
const shared = globalThis as typeof globalThis & { __tripPaintingPhotoSnapshotsV1?: Runtime };
const runtime = (shared.__tripPaintingPhotoSnapshotsV1 ??= {
  active: new Set(),
  cleaning: false,
  after: '',
});
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

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

export async function preparePhotoFile(
  uri: string,
  context?: PhotoSnapshotContext,
): Promise<PreparedPhotoFile> {
  const source = attachment(uri);
  if (context && !validSnapshotContext(context)) throw new PhotoFileError('invalid');
  let owned: Directory | null = null;
  const dispose = async () => {
    if (owned?.exists) owned.delete();
    if (owned) runtime.active.delete(owned.uri);
    owned = null;
  };
  try {
    if (!source.exists) throw new PhotoFileError('missing');
    if (source.size > maxBytes) throw new PhotoFileError('tooLarge');
    // An exclusive per-attempt copy binds the hash and multipart body to the same bytes.
    const attemptId = Crypto.randomUUID();
    const canMark = context && uri.startsWith('visit-photos/') && snapshotUuid(Constants.sessionId);
    const root = new Directory(Paths.cache, snapshotRoot);
    if (canMark) root.create({ idempotent: true, intermediates: true });
    const directory = canMark
      ? new Directory(root, attemptId)
      : new Directory(Paths.cache, `photo-backup-${attemptId}`);
    directory.create();
    owned = directory;
    runtime.active.add(directory.uri);
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
    const sha256 = await digest(bytes);
    const fileName = mimeType === 'image/png' ? 'attachment.png' : 'attachment.jpg';
    frozen.rename(fileName);
    if (canMark) {
      const manifest: PhotoSnapshotManifest = {
        format: 'trip-painting-upload-snapshot-v1',
        attemptId,
        nativeSessionId: Constants.sessionId,
        ...context,
        sourceUri: uri,
        fileName,
        sha256,
        byteLength: bytes.byteLength,
        mimeType,
      };
      if (!readSnapshotManifest(manifest, attemptId)) throw new PhotoFileError('invalid');
      const marker = new File(directory, snapshotMarker);
      marker.create();
      marker.write(JSON.stringify(manifest));
    }
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

export async function cleanupPreparedPhotoFiles(
  options: PhotoSnapshotCleanupOptions,
): Promise<PhotoSnapshotCleanup> {
  const result = { examined: 0, removed: 0, bytesRemoved: 0 };
  const nativeSessionId = Constants.sessionId;
  if (runtime.cleaning || !snapshotUuid(nativeSessionId) || !options.isCurrent()) return result;
  runtime.cleaning = true;
  try {
    const root = new Directory(Paths.cache, snapshotRoot);
    if (!root.exists) return result;
    const entries = root.list().sort((a, b) => a.name.localeCompare(b.name));
    const start = entries.findIndex((e) => e.name > runtime.after);
    const rotated = start < 0 ? entries : [...entries.slice(start), ...entries.slice(0, start)];
    let reservedBytes = 0;
    for (const entry of rotated.slice(0, 20)) {
      if (!options.isCurrent()) break;
      runtime.after = entry.name;
      result.examined++;
      if (
        !(entry instanceof Directory) ||
        !snapshotUuid(entry.name) ||
        runtime.active.has(entry.uri)
      )
        continue;
      try {
        const marker = new File(entry, snapshotMarker);
        if (!marker.exists || marker.size > 4096) continue;
        const serialized = await marker.text();
        const m = readSnapshotManifest(JSON.parse(serialized), entry.name);
        if (!m || m.ownerId !== options.ownerId || m.nativeSessionId === nativeSessionId) continue;
        const layoutMatches = () => {
          const list = entry.list();
          return (
            list.length === 2 &&
            list.every((f) => f instanceof File && [snapshotMarker, m.fileName].includes(f.name))
          );
        };
        const frozen = new File(entry, m.fileName),
          source = attachment(m.sourceUri);
        if (
          !layoutMatches() ||
          !frozen.exists ||
          frozen.size !== m.byteLength ||
          !source.exists ||
          source.size !== m.byteLength
        )
          continue;
        // A bounded pass reads at most 64MiB, including the final synchronous comparison.
        if (reservedBytes + m.byteLength * 3 > 64 * 1024 * 1024) continue;
        reservedBytes += m.byteLength * 3;
        const bytes = Uint8Array.from(await frozen.bytes());
        if (bytes.byteLength !== m.byteLength || (await digest(bytes)) !== m.sha256) continue;
        await options.removeAcknowledged(m, () => {
          // The repository checks the ACK under its transaction lock. Do not yield
          // between rechecking files and deleting this redundant cache copy.
          if (
            !options.isCurrent() ||
            Constants.sessionId !== nativeSessionId ||
            runtime.active.has(entry.uri) ||
            !layoutMatches() ||
            !marker.exists ||
            marker.size > 4096 ||
            marker.textSync() !== serialized ||
            !source.exists ||
            source.size !== m.byteLength ||
            !frozen.exists ||
            frozen.size !== m.byteLength
          )
            return false;
          const originalNow = source.bytesSync(),
            copyNow = frozen.bytesSync();
          if (
            originalNow.length !== bytes.length ||
            copyNow.length !== bytes.length ||
            !bytes.every((b, i) => b === originalNow[i] && b === copyNow[i]) ||
            !options.isCurrent()
          )
            return false;
          frozen.delete();
          result.removed++;
          result.bytesRemoved += m.byteLength;
          try {
            marker.delete();
            if (entry.list().length === 0) entry.delete();
          } catch {
            /* Only tiny owned metadata may remain. */
          }
          return true;
        });
      } catch {
        /* Unreadable, changed or unproven files are preserved. */
      }
    }
  } catch {
    /* Cache maintenance must not prevent opening or backing up records. */
  } finally {
    runtime.cleaning = false;
  }
  return result;
}
