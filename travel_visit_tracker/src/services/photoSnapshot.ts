import { validPhotoFingerprint } from './photoSync';
import type { PhotoFingerprint } from '../storage/outbox';

export type PhotoSnapshotContext = { ownerId: string; operationId: string; photoId: string };
export type PhotoSnapshotManifest = PhotoSnapshotContext &
  PhotoFingerprint & {
    format: 'trip-painting-upload-snapshot-v1';
    attemptId: string;
    nativeSessionId: string;
    sourceUri: string;
    fileName: 'attachment.png' | 'attachment.jpg';
  };
export type PhotoSnapshotCleanup = { examined: number; removed: number; bytesRemoved: number };
export type PhotoSnapshotCleanupOptions = {
  ownerId: string;
  isCurrent(): boolean;
  removeAcknowledged(snapshot: PhotoSnapshotManifest, remove: () => boolean): Promise<boolean>;
};
export const snapshotRoot = 'photo-upload-snapshots-v1';
export const snapshotMarker = 'ownership.json';
export const snapshotUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function validSnapshotContext(value: PhotoSnapshotContext): boolean {
  return (
    !!value &&
    typeof value.ownerId === 'string' &&
    value.ownerId.startsWith('account:') &&
    value.ownerId.length <= 2048 &&
    !Array.from(value.ownerId).some((character) => character.charCodeAt(0) < 32) &&
    snapshotUuid(value.operationId) &&
    snapshotUuid(value.photoId)
  );
}
export function readSnapshotManifest(
  value: unknown,
  attemptId: string,
): PhotoSnapshotManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as PhotoSnapshotManifest;
  if (
    Object.keys(m).length !== 11 ||
    Object.keys(m).some(
      (k) =>
        ![
          'format',
          'attemptId',
          'nativeSessionId',
          'ownerId',
          'operationId',
          'photoId',
          'sourceUri',
          'fileName',
          'sha256',
          'byteLength',
          'mimeType',
        ].includes(k),
    ) ||
    m.format !== 'trip-painting-upload-snapshot-v1' ||
    m.attemptId !== attemptId ||
    !snapshotUuid(attemptId) ||
    !snapshotUuid(m.nativeSessionId) ||
    !validSnapshotContext(m) ||
    typeof m.sourceUri !== 'string' ||
    !/^visit-photos\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)$/i.test(m.sourceUri) ||
    !validPhotoFingerprint(m) ||
    m.fileName !== (m.mimeType === 'image/png' ? 'attachment.png' : 'attachment.jpg')
  )
    return null;
  return m;
}
