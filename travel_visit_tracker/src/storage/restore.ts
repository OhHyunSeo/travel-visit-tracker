import type { PhotoAcknowledgement } from './outbox';

export type RemotePhoto = PhotoAcknowledgement['photo'];
export type RemoteVisit = {
  id: string;
  revision: number;
  sessionId: string | null;
  regionId: string | null;
  startedAt: number | null;
  confirmedAt: number | null;
  source: 'gps' | null;
  deletedAt: number | null;
};
export type RestorePage<T> = { items: T[]; cursor: number; hasMore: boolean };
export type RestoreState = {
  visitCursor: number;
  photoCursor: number;
  visitScan: number;
  photoScan: number;
  pendingVisits: number;
  pendingPhotos: number;
  blocked: number;
};
export const emptyRestoreState: RestoreState = {
  visitCursor: 0,
  photoCursor: 0,
  visitScan: 0,
  photoScan: 0,
  pendingVisits: 0,
  pendingPhotos: 0,
  blocked: 0,
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 8640000000000000;
export const cursorValid = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const invalid = () =>
  new Error('서버의 복원 자료를 확인할 수 없습니다. 기기 기록과 복원 대기는 보존했습니다.');
export function remoteVisit(v: unknown): RemoteVisit {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !cursorValid(v.revision) ||
    v.revision === 0 ||
    (v.deletedAt !== null && !time(v.deletedAt))
  )
    throw invalid();
  const full =
    uuid(v.sessionId) &&
    typeof v.regionId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(v.regionId) &&
    time(v.startedAt) &&
    time(v.confirmedAt) &&
    v.confirmedAt - v.startedAt >= 300000 &&
    v.source === 'gps';
  const tombstone =
    v.deletedAt !== null &&
    v.sessionId === null &&
    v.regionId === null &&
    v.startedAt === null &&
    v.confirmedAt === null &&
    (v.source === null || v.source === 'gps');
  if (!full && !tombstone) throw invalid();
  return {
    id: v.id,
    revision: v.revision,
    sessionId: v.sessionId as string | null,
    regionId: v.regionId as string | null,
    startedAt: v.startedAt as number | null,
    confirmedAt: v.confirmedAt as number | null,
    source: v.source as 'gps' | null,
    deletedAt: v.deletedAt as number | null,
  };
}
export function remotePhoto(v: unknown): RemotePhoto {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !uuid(v.visitId) ||
    typeof v.createdAt !== 'number' ||
    !Number.isFinite(v.createdAt) ||
    v.createdAt < 0 ||
    v.createdAt > Number.MAX_SAFE_INTEGER ||
    !cursorValid(v.revision) ||
    v.revision === 0 ||
    typeof v.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.sha256) ||
    !Number.isSafeInteger(v.byteLength) ||
    (v.byteLength as number) < 1 ||
    (v.byteLength as number) > 10485760 ||
    !['image/jpeg', 'image/png'].includes(v.mimeType as string) ||
    v.originalPath !== `/api/visit-photos/${v.id}/original` ||
    v.thumbnailPath !== `/api/visit-photos/${v.id}/thumbnail`
  )
    throw invalid();
  return {
    id: v.id,
    visitId: v.visitId,
    createdAt: v.createdAt,
    revision: v.revision,
    sha256: v.sha256,
    byteLength: v.byteLength as number,
    mimeType: v.mimeType as RemotePhoto['mimeType'],
    originalPath: v.originalPath as string,
    thumbnailPath: v.thumbnailPath as string,
  };
}
function page<T extends { id: string; revision: number }>(
  value: unknown,
  key: string,
  after: number,
  parse: (v: unknown) => T,
  limit: number,
): RestorePage<T> {
  if (
    !cursorValid(after) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !object(value) ||
    !Array.isArray(value[key]) ||
    !cursorValid(value.cursor) ||
    typeof value.hasMore !== 'boolean'
  )
    throw invalid();
  const items = (value[key] as unknown[]).map(parse);
  if (
    items.length > limit ||
    new Set(items.map((x) => x.id)).size !== items.length ||
    items.some((x, i) => x.revision <= (i ? items[i - 1].revision : after)) ||
    value.cursor !== (items.at(-1)?.revision ?? after) ||
    (value.hasMore && items.length !== limit)
  )
    throw invalid();
  return { items, cursor: value.cursor, hasMore: value.hasMore };
}
export const visitPage = (v: unknown, after: number, limit = 100) =>
  page(v, 'visits', after, remoteVisit, limit);
export const photoPage = (v: unknown, after: number, limit = 100) =>
  page(v, 'photos', after, remotePhoto, limit);
