import { PhotoFileError, type PreparedPhotoFile } from './photoSync';
import type {
  PhotoSnapshotContext,
  PhotoSnapshotCleanupOptions,
  PhotoSnapshotCleanup,
} from './photoSnapshot';

export async function preparePhotoFile(
  _uri: string,
  _context?: PhotoSnapshotContext,
): Promise<PreparedPhotoFile> {
  throw new PhotoFileError('unsupported');
}
export async function cleanupPreparedPhotoFiles(
  _options: PhotoSnapshotCleanupOptions,
): Promise<PhotoSnapshotCleanup> {
  return { examined: 0, removed: 0, bytesRemoved: 0 };
}
